import type { LobbyContext } from '../context';
import { json, parseBody, randomId } from '../http';
import { persistRuntimeState } from '../persistence';
import { broadcastTicket } from '../sockets';
import { findActiveSeatByActorId, findWaitingTicketByActorId, roomToState, tryJoinOpenWaitingRoom, assignMatch } from '../rooms';
import { getAgentFromAuth } from '../rooms';
import { matchmakingJoinSchema } from '../types';
import type { MatchRequest } from '../types';

export async function handleMatchmakingRoutes(ctx: LobbyContext, req: Request, pathname: string): Promise<Response | null> {
  if (req.method === 'POST' && pathname === '/api/matchmaking/join') {
    const parsed = matchmakingJoinSchema.safeParse(await parseBody(req));
    if (!parsed.success) {
      return json({ error: parsed.error.flatten() }, 400);
    }

    let actorId = randomId();
    if (parsed.data.actorType === 'agent') {
      const agent = getAgentFromAuth(ctx, req);
      if (!agent) {
        return json({ error: 'invalid agent token' }, 401);
      }
      actorId = agent.id;
    } else {
      actorId = parsed.data.clientToken ?? actorId;
    }

    const ticketId = randomId();
    const me: MatchRequest = {
      actorType: parsed.data.actorType,
      actorId,
      name: parsed.data.name,
      locale: parsed.data.locale,
    };

    const existingSeat = findActiveSeatByActorId(ctx, actorId);
    if (existingSeat) {
      if (parsed.data.actorType === 'human' && parsed.data.locale && existingSeat.seat.locale !== parsed.data.locale) {
        existingSeat.seat.locale = parsed.data.locale;
        await persistRuntimeState(ctx);
      }
      return json({
        matched: existingSeat.room.status === 'playing',
        ticketId,
        roomId: existingSeat.room.id,
        seatToken: existingSeat.seat.seatToken,
        side: existingSeat.seat.side,
        state: roomToState(ctx, existingSeat.room),
        reused: true,
      });
    }

    const existingTicketId = findWaitingTicketByActorId(ctx, actorId);
    if (existingTicketId) {
      const waiting = ctx.waitingByTicket.get(existingTicketId);
      if (waiting && parsed.data.actorType === 'human') {
        waiting.locale = parsed.data.locale;
        waiting.name = parsed.data.name;
        await persistRuntimeState(ctx);
      }
      return json({ matched: false, ticketId: existingTicketId, reused: true }, 202);
    }

    const directJoin = await tryJoinOpenWaitingRoom(ctx, me);
    if (directJoin) {
      return json({
        matched: true,
        ticketId,
        roomId: directJoin.roomId,
        seatToken: directJoin.seatToken,
        side: directJoin.side,
        state: directJoin.state,
      }, 201);
    }

    ctx.waitingByTicket.set(ticketId, me);
    await persistRuntimeState(ctx);

    const opponentTicketId = Array.from(ctx.waitingByTicket.entries())
      .find(([candidateTicketId, candidate]) => candidateTicketId !== ticketId && candidate.actorId !== me.actorId)?.[0];

    if (!opponentTicketId) {
      return json({ matched: false, ticketId }, 202);
    }

    await assignMatch(ctx, opponentTicketId, ticketId);
    const leftAssign = ctx.assignmentByTicket.get(opponentTicketId);
    const rightAssign = ctx.assignmentByTicket.get(ticketId);
    if (leftAssign) {
      broadcastTicket(ctx, opponentTicketId, {
        type: 'matchmaking',
        matched: true,
        ticketId: leftAssign.ticketId,
        roomId: leftAssign.roomId,
        seatToken: leftAssign.seatToken,
        side: leftAssign.side,
        state: leftAssign.state,
      });
    }
    if (rightAssign) {
      broadcastTicket(ctx, ticketId, {
        type: 'matchmaking',
        matched: true,
        ticketId: rightAssign.ticketId,
        roomId: rightAssign.roomId,
        seatToken: rightAssign.seatToken,
        side: rightAssign.side,
        state: rightAssign.state,
      });
    }

    const assignment = ctx.assignmentByTicket.get(ticketId);
    if (!assignment) {
      return json({ error: 'failed to assign matchmaking room' }, 500);
    }
    ctx.assignmentByTicket.delete(ticketId);
    await persistRuntimeState(ctx);
    return json({
      matched: true,
      ticketId,
      roomId: assignment.roomId,
      seatToken: assignment.seatToken,
      side: assignment.side,
      state: assignment.state,
    }, 201);
  }

  const matchmakingMatch = pathname.match(/^\/api\/matchmaking\/([^/]+)$/);
  if (req.method === 'GET' && matchmakingMatch) {
    const ticketId = matchmakingMatch[1];
    const assignment = ctx.assignmentByTicket.get(ticketId);
    if (assignment) {
      ctx.assignmentByTicket.delete(ticketId);
      await persistRuntimeState(ctx);
      return json({
        matched: true,
        ticketId: assignment.ticketId,
        roomId: assignment.roomId,
        seatToken: assignment.seatToken,
        side: assignment.side,
        state: assignment.state,
      });
    }
    if (ctx.waitingByTicket.has(ticketId)) {
      return json({ matched: false, ticketId }, 202);
    }
    return json({ error: 'ticket not found' }, 404);
  }

  return null;
}
