import type { createDatabase } from "@hambazi/database";
import type { KahrobaRuntimeConfig } from "@hambazi/config";
import { createErrorEnvelope } from "@hambazi/contracts";
import { createPrivateRegistrationCatalog } from "../games/index.js";
import { createRoomsPort, type RoomsHttpDependencies } from "../rooms/index.js";
import { createUserIdentityPort, createPublicNamesPort } from "../users/index.js";
import {
  createMatchProcessingPort,
  createPrivateRoomMatchPort,
  createMatchResyncPort,
  createMatchMembershipPort,
  createMatchReconnectPort,
} from "../matches/index.js";
import { createPresencePort } from "../presence/index.js";
import { createKahrobaMatchGame, kahrobaMatchDescriptor } from "./kahroba-match.js";
import type { RealtimeDependencies } from "../realtime/index.js";
import type { AuthSessions, OwnerAdmission } from "../auth/index.js";
import type { parseRoomsConfig, TransportAdmissionPolicy } from "@hambazi/config";
import type { createRedisTransportAdmission } from "../realtime/index.js";

/** Actual runtime composition, also used by the application entry point. No fixture ports. */
export function createKahrobaRuntimePorts(
  database: ReturnType<typeof createDatabase>,
  options: {
    config: KahrobaRuntimeConfig;
    clock: { nowMs(): number };
    sessions: AuthSessions;
    owner: OwnerAdmission;
    roomConfig: NonNullable<ReturnType<typeof parseRoomsConfig>>;
    roomRate: RoomsHttpDependencies["rate"];
    transport: ReturnType<typeof createRedisTransportAdmission>;
    policy: TransportAdmissionPolicy;
    origins: readonly string[];
    coexists: boolean;
  },
) {
  if (!options.roomConfig.target) throw new Error("KAHROBA_RUNTIME_CONFIGURATION_INVALID");
  const { config, clock } = options;
  const game = createKahrobaMatchGame({
    rulesetVersion: "kahroba-base-v1",
    datasetVersion: "kahroba-economy-v1",
    turnDurationMs: null,
    timeoutPolicyVersion: null,
  });
  const catalog = createPrivateRegistrationCatalog(database, {
    id: "kahroba",
    slug: "kahroba",
    title: "کهربا",
    minPlayers: 2,
    maxPlayers: config.maxPlayers,
    status: "ACTIVE",
    playable: config.admission,
    readiness: "NOT_IMPLEMENTED",
    descriptor: null,
    matchmakingModes: [{ id: "standard", title: "Standard" }],
    matchmakingEnabled: false,
    privateRoomsEnabled: config.admission,
    chatEnabled: false,
    voiceEnabled: false,
  });
  const users = createUserIdentityPort(database);
  const roomPort = createRoomsPort(
    database,
    { clock, ttlSeconds: options.roomConfig.ttlSeconds },
    {
      users,
      games: catalog,
      invites: {
        target: options.roomConfig.target,
        consume: (userId) => options.roomRate("invite", userId),
      },
    },
  );
  async function canCreate(userId: string) {
    const telegramId = await options.owner.telegramId();
    if (!telegramId || !(await options.owner.allowsUserId(userId))) return false;
    const owner = await users.findActiveByTelegramId(telegramId);
    return owner?.userId === userId && (await options.owner.telegramId()) === telegramId;
  }
  const rooms = Object.freeze({
    ...roomPort,
    create: async (identity: unknown, input: unknown) => {
      if (typeof identity !== "string" || !(await canCreate(identity)))
        return createErrorEnvelope("FORBIDDEN");
      return roomPort.create(identity, input);
    },
  });
  const matches = createMatchProcessingPort(
    database,
    { clock, games: [game], deferReadyTransition: true },
    users,
  );
  const privateRooms = createPrivateRoomMatchPort(
    database,
    { clock },
    {
      rooms,
      manualStart: true,
      processing: matches,
      users,
      games: catalog,
      descriptor: async (input) => kahrobaMatchDescriptor(input),
    },
  );
  const resync = createMatchResyncPort(database, [game]);
  const reconnect = createMatchReconnectPort(database, { clock, policy: config.reconnect });
  const denied = async () => createErrorEnvelope("FORBIDDEN");
  const realtime: RealtimeDependencies = {
    sessions: options.sessions,
    rooms,
    matches,
    privateRooms,
    membership: createMatchMembershipPort(database),
    matchmaking: { search: denied, read: denied, cancel: denied, found: denied, admit: denied },
    rate: options.transport.rate,
    admission: {
      policy: options.policy,
      ip: options.transport.ip,
      trustedProxies: [],
      production: false,
    },
    allowedOrigins: options.origins,
    nowMs: clock.nowMs,
    transport: {
      namespace: "/kahroba-v1",
      path: "/v1/kahroba/socket.io",
      coexists: options.coexists,
    },
    delivery: { resync, ackTimeoutMs: 2000 },
    presence: {
      port: createPresencePort({ reconnect, resync }),
      heartbeatIntervalMs: Math.max(250, Math.floor(config.reconnect.leaseMs / 3)),
      heartbeatTimeoutMs: 2000,
      leaseMs: config.reconnect.leaseMs,
    },
  };
  return {
    canCreate,
    game,
    catalog,
    rooms,
    matches,
    privateRooms,
    resync,
    realtime,
    names: createPublicNamesPort(database),
  };
}
export type KahrobaRuntimePorts = ReturnType<typeof createKahrobaRuntimePorts>;
