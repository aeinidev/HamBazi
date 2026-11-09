# Graph Report - HamBazi  (2026-11-05)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 5918 nodes · 15542 edges · 266 communities (215 shown, 51 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 271 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `30eaec01`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- Community 0
- Community 1
- Community 2
- Community 3
- Community 4
- Community 5
- Community 6
- Community 7
- Community 8
- Community 9
- Community 10
- Community 11
- Community 12
- Community 13
- Community 14
- Community 15
- Community 16
- Community 17
- Community 18
- Community 19
- Community 20
- Community 21
- Community 22
- Community 23
- Community 24
- Community 25
- Community 26
- Community 27
- Community 28
- Community 29
- Community 30
- Community 31
- Community 32
- Community 33
- Community 34
- Community 35
- Community 36
- Community 37
- Community 38
- Community 39
- Community 40
- Community 41
- Community 42
- Community 43
- Community 44
- Community 45
- Community 46
- Community 47
- Community 48
- Community 49
- Community 50
- Community 51
- Community 52
- Community 53
- Community 54
- Community 55
- Community 56
- Community 57
- Community 58
- Community 59
- Community 60
- Community 61
- Community 62
- Community 63
- Community 64
- Community 65
- Community 66
- Community 67
- Community 68
- Community 69
- Community 70
- Community 71
- Community 72
- Community 73
- Community 74
- Community 75
- Community 76
- Community 77
- Community 78
- Community 79
- Community 80
- Community 81
- Community 82
- Community 83
- Community 84
- Community 85
- Community 86
- Community 87
- Community 88
- Community 89
- Community 90
- Community 91
- Community 92
- Community 93
- Community 94
- Community 95
- Community 96
- Community 97
- Community 98
- Community 99
- Community 100
- Community 101
- Community 102
- Community 103
- Community 104
- Community 105
- Community 106
- Community 107
- Community 108
- Community 109
- Community 110
- Community 111
- Community 112
- Community 113
- Community 114
- Community 115
- Community 116
- Community 117
- Community 118
- Community 119
- Community 120
- Community 121
- Community 122
- Community 123
- Community 124
- Community 125
- Community 126
- Community 127
- Community 128
- Community 129
- Community 130
- Community 131
- Community 132
- Community 133
- Community 134
- Community 135
- Community 136
- Community 137
- Community 138
- Community 139
- Community 140
- Community 141
- Community 142
- Community 143
- Community 144
- Community 145
- Community 146
- Community 147
- Community 148
- Community 149
- Community 150
- Community 151
- Community 152
- Community 153
- Community 154
- Community 155
- Community 156
- Community 157
- Community 158
- Community 159
- Community 160
- Community 161
- Community 162
- Community 163
- Community 164
- Community 165
- Community 166
- Community 167
- Community 168
- Community 169
- Community 170
- Community 171
- Community 172
- Community 173
- Community 174
- Community 175
- Community 176
- Community 177
- Community 178
- Community 179
- Community 180
- Community 181
- Community 182
- Community 183
- Community 184
- Community 185
- Community 186
- Community 187
- Community 188
- Community 189
- Community 190
- Community 191
- Community 192
- Community 193
- Community 194
- Community 195
- Community 196
- Community 197
- Community 198
- Community 199
- Community 200
- Community 201
- Community 202
- Community 203
- Community 204
- Community 205
- Community 206
- Community 207
- Community 208
- Community 209
- Community 210
- Community 211
- Community 212
- Community 213
- Community 214
- Community 215
- Community 216
- Community 217
- Community 218
- Community 219
- Community 220
- Community 221
- Community 222
- Community 223
- Community 224
- Community 225
- Community 226
- Community 227
- Community 228
- Community 229
- Community 230
- Community 231
- Community 232
- Community 233
- Community 234
- Community 235
- Community 236
- Community 237
- Community 238
- Community 239
- Community 240
- Community 241
- Community 248
- Community 249
- Community 250

## God Nodes (most connected - your core abstractions)
1. `createErrorEnvelope()` - 146 edges
2. `createDatabase()` - 105 edges
3. `startApi()` - 58 edges
4. `useRuntime()` - 53 edges
5. `createCorrelation()` - 53 edges
6. `useSession()` - 46 edges
7. `receiveWebViewEvent()` - 46 edges
8. `ClientError` - 43 edges
9. `currentCorrelation()` - 41 edges
10. `WebApp` - 41 edges

## Surprising Connections (you probably didn't know these)
- `change()` --indirect_call--> `directory()`  [INFERRED]
  apps/api/tests/integration/release-contract.test.mjs → infra/tests/local-services.test.mjs
- `reset()` --indirect_call--> `directory()`  [INFERRED]
  apps/api/tests/integration/release-contract.test.mjs → infra/tests/local-services.test.mjs
- `confirm()` --indirect_call--> `noble()`  [INFERRED]
  apps/web/src/games/kahroba/components/actions.tsx → packages/games/kahroba-engine/tests/helpers.ts
- `readStagingTestDeferralTarget()` --indirect_call--> `service()`  [INFERRED]
  infra/release/staging-test-deferral.mjs → apps/api/tests/integration/sessions.test.ts
- `safe()` --calls--> `createErrorEnvelope()`  [EXTRACTED]
  apps/api/src/matches/application/admission.ts → packages/contracts/src/errors.ts

## Import Cycles
- None detected.

## Communities (266 total, 51 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.04
Nodes (61): args, local, { Client }, compose, execute, { parse }, password, require (+53 more)

### Community 1 - "Community 1"
Cohesion: 0.03
Nodes (58): baseline, document, target, baseline, target, baseline, document, healthBaseline (+50 more)

### Community 2 - "Community 2"
Cohesion: 0.03
Nodes (87): statusTitles, Page, states, titles, AdminManagement, adminRoleTemplates, AdminCapability, adminPendingCookie (+79 more)

### Community 3 - "Community 3"
Cohesion: 0.06
Nodes (48): MatchMembershipPort, actionId(), PrivateRoomMatchPort, MatchResyncPort, PersonalMatchPort, incomingEvents, Ack, createRealtimeGateway() (+40 more)

### Community 4 - "Community 4"
Cohesion: 0.05
Nodes (50): AccountCandidate, AccountCreationPort, accountCreationService(), project(), AccountRecord, AccountRepository, IdentityRepository, identityService() (+42 more)

### Community 5 - "Community 5"
Cohesion: 0.05
Nodes (64): createBotInternalHttpModule(), send(), authPaths, createAuthHttpModule(), sendRateDecision(), createBotInternalHttpApplication(), HttpAdmission, installHttpAdmission() (+56 more)

### Community 6 - "Community 6"
Cohesion: 0.06
Nodes (55): browserPolicyPlugin(), check(), markers, output, previewIdentity, BrowserPolicyInput, createBrowserPolicy(), invalid() (+47 more)

### Community 7 - "Community 7"
Cohesion: 0.06
Nodes (42): adminOperationPermissions, generateAdminPassword(), AdminOperation, AdminProductPort, AdminRole, AdminAudit, AdminCode, AdminCrypto (+34 more)

### Community 8 - "Community 8"
Cohesion: 0.05
Nodes (64): Access, AdminApp(), logout(), submit(), errorMessage(), metricTitles, OwnerSecuritySettings(), change() (+56 more)

### Community 9 - "Community 9"
Cohesion: 0.04
Nodes (76): dependencies, @hambazi/contracts@workspace:*, @hambazi/validation@workspace:*, react@19.3.0, react-dom@19.3.0, @tanstack/react-query@5.104.0, zod@4.6.6, devDependencies (+68 more)

### Community 10 - "Community 10"
Cohesion: 0.13
Nodes (49): Shell(), DirectCoupPreview(), AuthScreen(), submit(), TelegramWelcome(), MatchChat(), availabilityLabel(), useLobbyAvailability() (+41 more)

### Community 11 - "Community 11"
Cohesion: 0.07
Nodes (61): cardIdSchema, choices, coherentPublicView(), commandSchema, countSchema, DevelopmentCard, developmentCardSchema, GEM_COLORS (+53 more)

### Community 12 - "Community 12"
Cohesion: 0.07
Nodes (40): execute, runGate(), runSequence(), buildStagingComponents(), invalid(), root, componentSourceCommit(), selectedComponentRoles() (+32 more)

### Community 13 - "Community 13"
Cohesion: 0.07
Nodes (49): capsule, key(), magic, openOwnerBackup(), OwnerBackupCapsule, ownerDumpArguments, sealOwnerBackup(), actualTerminal() (+41 more)

### Community 14 - "Community 14"
Cohesion: 0.06
Nodes (44): Ack, CreateRoomInput, createRoomSchema, Outcome, resolveInviteSchema, RoomCommand, RoomsRepository, roomsService() (+36 more)

### Community 15 - "Community 15"
Cohesion: 0.10
Nodes (33): limits(), check_files(), command(), deploy(), require(), served_certificate(), validate_certificate(), contain() (+25 more)

### Community 16 - "Community 16"
Cohesion: 0.06
Nodes (48): callEventCallbacks(), getRequestedContact(), locationResponse(), onAccelerometerChanged(), onAccelerometerFailed(), onAccelerometerStarted(), onAccelerometerStopped(), onBackButtonPressed() (+40 more)

### Community 17 - "Community 17"
Cohesion: 0.07
Nodes (39): MatchAutomationPort, MatchJob, matchJobId(), matchJobProcessor(), matchJobSchema, settings, startMatchAutomation(), recover() (+31 more)

### Community 18 - "Community 18"
Cohesion: 0.09
Nodes (35): createBackend(), call(), Delivery, RetryDelivery, SupportDelivery, createBotHttp(), BotLogger, createBotLogger() (+27 more)

### Community 19 - "Community 19"
Cohesion: 0.07
Nodes (36): createRedisAuthRateLimiter(), createBotOnboardingRepository(), createSupportRepository(), createAuthSessions(), createBotOnboarding(), createSafeLogger(), createAccountCreationPort(), register() (+28 more)

### Community 20 - "Community 20"
Cohesion: 0.09
Nodes (37): root, definitions, createMetricCollection(), ownValue(), safeTraceparent(), HealthCheck, HealthSnapshot, HealthStatus (+29 more)

### Community 21 - "Community 21"
Cohesion: 0.06
Nodes (44): createKahrobaRuntimePorts(), KahrobaRuntimePorts, AdmissionOutcome, createMatchAdmissionPort(), createMatchMembershipPort(), createMatchProcessingPort(), createMatchResyncPort(), createPrivateRoomMatchPort() (+36 more)

### Community 22 - "Community 22"
Cohesion: 0.08
Nodes (46): coupClaimsRulesSchema, incompatible(), migrateCoupState(), unique(), upcastCoupEvent(), validClaim(), coupReconnectPolicy, coupTimerPolicy (+38 more)

### Community 23 - "Community 23"
Cohesion: 0.09
Nodes (47): active(), applyCoupEvent(), assertVersion(), changedPlayer(), CoreCommand, coupCoreEngine, CoupErrorCode, CoupPlayerView (+39 more)

### Community 24 - "Community 24"
Cohesion: 0.07
Nodes (34): LobbyAvailability, lobbyAvailability(), lobbyAvailabilitySchema, CatalogGame, CatalogPort, CatalogRepository, catalogService(), Failure (+26 more)

### Community 25 - "Community 25"
Cohesion: 0.07
Nodes (28): startAdmin(), createGamesAdminManagementRead(), createGamesAdminReadRepository(), MatchMembership, MatchMembershipRepository, matchMembershipService(), reference, createMatchesAdminManagementRead() (+20 more)

### Community 26 - "Community 26"
Cohesion: 0.08
Nodes (46): count(), invalid(), projectScan(), scannerStages, invalid(), scanApplications(), invalid(), policy (+38 more)

### Community 27 - "Community 27"
Cohesion: 0.05
Nodes (49): @hambazi/typescript, typescript, dependencies, @hambazi/shared@workspace:*, devDependencies, @hambazi/typescript@workspace:*, typescript@6.0.3, exports (+41 more)

### Community 28 - "Community 28"
Cohesion: 0.09
Nodes (28): miniAppOnboardingService(), SessionRepository, sessionService(), uuid, isLiveSession(), SessionRecord, createSessionCodec(), environment (+20 more)

### Community 29 - "Community 29"
Cohesion: 0.07
Nodes (27): parseBotExperienceConfig(), parseCatalogConfig(), parseChatConfig(), parseGameAvailabilityConfig(), flag, integer(), invalid(), KahrobaRuntimeConfig (+19 more)

### Community 30 - "Community 30"
Cohesion: 0.09
Nodes (35): client, root, App(), toCoupView(), publicSnapshot(), createKahrobaCommandLifecycle(), useKahrobaCommands(), activated() (+27 more)

### Community 31 - "Community 31"
Cohesion: 0.05
Nodes (24): actors, admissionKey, body(), botToken, clock, close(), closes, controlRequest() (+16 more)

### Community 32 - "Community 32"
Cohesion: 0.07
Nodes (15): checkVersion(), generateCallbackId(), invokeCustomMethod(), invokeStorageMethod(), isTmeHostname(), WebApp, linkHandler(), setClosingConfirmation() (+7 more)

### Community 33 - "Community 33"
Cohesion: 0.08
Nodes (44): actionKind, base, claim, command, count, CoupCommand, CoupRole, CoupView (+36 more)

### Community 34 - "Community 34"
Cohesion: 0.10
Nodes (43): RandomSource, applyCoupClaimsEvent(), coins(), coupClaimsEngine, createCoupClaimsState(), end(), executeCoupClaimsCommand(), fail() (+35 more)

### Community 35 - "Community 35"
Cohesion: 0.08
Nodes (38): target, canShareKahrobaRoom(), KahrobaLobbyInvite, KahrobaLobbyRoom, shareKahrobaInvite(), verifiedKahrobaInvite(), verifyKahrobaInvitePreview(), currentKahrobaSearchSchema (+30 more)

### Community 36 - "Community 36"
Cohesion: 0.05
Nodes (45): bootstrap, { Client }, clock, crypto, execute(), games, matches, options (+37 more)

### Community 37 - "Community 37"
Cohesion: 0.07
Nodes (28): botCleanupService(), ownerAdmissionPolicy(), admittedTelegramIds(), telegramId(), AuthSessions, SessionClaims, SessionClock, SessionCodec (+20 more)

### Community 38 - "Community 38"
Cohesion: 0.09
Nodes (34): ChatDelivery, chatDeliverySchema, ChatList, chatListSchema, ChatMessage, chatMessageSchema, ChatPage, chatPageSchema (+26 more)

### Community 39 - "Community 39"
Cohesion: 0.08
Nodes (44): advance(), applyCoupAnarchistEvent(), botPolicy, cardsEqual(), coupAnarchistModule, coupAnarchistPlayerViewSchema, coupAnarchistSpectatorViewSchema, current() (+36 more)

### Community 40 - "Community 40"
Cohesion: 0.09
Nodes (27): botExperience(), retry(), base, botOnboardingService(), contextSchema, id, messageId, BotOnboardingRepository (+19 more)

### Community 41 - "Community 41"
Cohesion: 0.04
Nodes (46): concurrency, cancel-in-progress, group, run, PLAYWRIGHT_NO_COPY_PROMPT, TEST_POSTGRES_BIN, TEST_POSTGRES_SHARE, TURBO_CACHE (+38 more)

### Community 42 - "Community 42"
Cohesion: 0.08
Nodes (28): createStatisticsProjection(), createMatchAutomationPort(), createMatchOutboxPort(), createMatchReconnectPort(), createMatchResultPort(), createProfileCleanup(), observation, config (+20 more)

### Community 43 - "Community 43"
Cohesion: 0.05
Nodes (45): POSTGRES_API_PASSWORD, POSTGRES_DB, POSTGRES_INITDB_ARGS, POSTGRES_MIGRATOR_PASSWORD, POSTGRES_PASSWORD, POSTGRES_USER, POSTGRES_WORKER_PASSWORD, REDIS_API_PASSWORD (+37 more)

### Community 44 - "Community 44"
Cohesion: 0.11
Nodes (41): actor(), actors, admissionTail, admitPair(), apply(), capture(), commandLatency, connected() (+33 more)

### Community 45 - "Community 45"
Cohesion: 0.10
Nodes (31): createAdapter(), restore(), safe(), createKahrobaMatchGame(), restore(), safe(), MatchFault, MatchRequest (+23 more)

### Community 46 - "Community 46"
Cohesion: 0.10
Nodes (38): GameCommandEnvelope, MatchEventEnvelope, MatchSnapshotEnvelope, Page, PageRequest, ActionId, EntityId, EventId (+30 more)

### Community 47 - "Community 47"
Cohesion: 0.06
Nodes (43): @hambazi/config@workspace:*, @hambazi/database@workspace:*, @hambazi/observability@workspace:*, @hambazi/config, @hambazi/database, @hambazi/observability, dependencies, grammy@1.46.0 (+35 more)

### Community 48 - "Community 48"
Cohesion: 0.08
Nodes (23): createGamesAdminOperationsRepository(), PrivateRoomMatchFault, privateRoomMatchSchema, createPrivateRoomMatchRepository(), read(), fixture(), AdminEffectCommand, AdminMatchReadQuery (+15 more)

### Community 49 - "Community 49"
Cohesion: 0.06
Nodes (42): dependencies, argon2@0.45.1, bullmq@6.3.8, fastify@5.12.7, @hambazi/coup-engine@workspace:*, @hambazi/kahroba-engine@workspace:*, jose@6.2.12, @nestjs/common@12.0.3 (+34 more)

### Community 50 - "Community 50"
Cohesion: 0.09
Nodes (34): main(), required(), startHttp(), startWorker(), capacityAutomationObservation(), capacityFailureKey(), codes, createCapacityDeliveryObservation() (+26 more)

### Community 51 - "Community 51"
Cohesion: 0.08
Nodes (25): createCoupMatchGame(), ReconnectOutcome, rules, a, admin, b, fixture(), active() (+17 more)

### Community 52 - "Community 52"
Cohesion: 0.09
Nodes (36): ack, metaSchema, Preview(), root, runtime, telegram, load(), close() (+28 more)

### Community 53 - "Community 53"
Cohesion: 0.09
Nodes (29): createAnarchistCoupMatchGame(), createKahrobaLocalAdmission(), logger, createPersonalAnarchistCoupGame(), createPersonalCoupGame(), createPersonalCoupGames(), personalRules, withPersonalPublicNames() (+21 more)

### Community 54 - "Community 54"
Cohesion: 0.11
Nodes (35): "consumer_receipts", "game_events", game_events_immutable, game_events_match_id_seq_key, game_events_no_truncate, "games", games_slug_key, hambazi_guard_match_versions() (+27 more)

### Community 55 - "Community 55"
Cohesion: 0.11
Nodes (28): personalCloseSchema, personalCurrentResultSchema, personalCurrentSchema, personalReadSchema, personalStartSchema, matchAckSchema, matchCommandSchema, matchLifecycleSchema (+20 more)

### Community 56 - "Community 56"
Cohesion: 0.11
Nodes (26): ChatMessage, chatMessageSchema, chatPageSchema, counter, createChatFeed(), text, open(), catchupSchema (+18 more)

### Community 57 - "Community 57"
Cohesion: 0.08
Nodes (17): loadTelegramSdk(), readTelegramLaunch(), telegramSdkSourceUrl, telegramSdkUrl, protectedPrototypes, protectTelegramStorage(), StorageHost, initData (+9 more)

### Community 58 - "Community 58"
Cohesion: 0.11
Nodes (29): Detail, GameFields(), ManagementProps, MatchFields(), ResourceDetail(), RoomFields(), GameManagement(), connections (+21 more)

### Community 59 - "Community 59"
Cohesion: 0.12
Nodes (23): countSchema, gameId, leaderboardQuerySchema, LeaderboardResponse, leaderboardResponseSchema, periodKey(), StatsFinish, statsFinishSchema (+15 more)

### Community 60 - "Community 60"
Cohesion: 0.06
Nodes (29): compilerOptions, noEmit, extends, include, compilerOptions, lib, noEmit, extends (+21 more)

### Community 61 - "Community 61"
Cohesion: 0.07
Nodes (33): dependencies, pg@8.23.0, @prisma/adapter-pg@7.10.0, @prisma/client@7.10.0, devDependencies, @hambazi/typescript@workspace:*, prisma@7.10.0, @types/node@24.13.4 (+25 more)

### Community 62 - "Community 62"
Cohesion: 0.18
Nodes (27): kahrobaCards, kahrobaNobles, kahrobaEngine, GEM_COLORS, KahrobaError, TOKEN_COLORS, colors, almostFinished() (+19 more)

### Community 63 - "Community 63"
Cohesion: 0.12
Nodes (27): privateRoomMatchService(), accepted(), advance(), descriptor(), fault(), follow(), safe(), verify() (+19 more)

### Community 64 - "Community 64"
Cohesion: 0.16
Nodes (32): bonuses(), getKahrobaCard(), getKahrobaNoble(), prestige(), applyKahrobaEvent(), createKahrobaInitialState(), events(), executeKahrobaTimeout() (+24 more)

### Community 65 - "Community 65"
Cohesion: 0.09
Nodes (25): MatchCorrelation, matchCorrelationSchema, uuid, MatchAck, MatchProcessingRepository, connectionCloseSchema, ConnectionLease, connectionLeaseSchema (+17 more)

### Community 66 - "Community 66"
Cohesion: 0.08
Nodes (21): MatchOutboxPort, metadata, OutboxClaim, OutboxEvent, OutboxPolicy, outboxPolicySchema, uuid, matchChangedIntentSchema (+13 more)

### Community 67 - "Community 67"
Cohesion: 0.08
Nodes (23): MatchDomainEvent, matchDomainEventSchema, createOutboxDispatcher(), dispatch(), report(), DeliveryEvent, DomainPublisher, OutboxEventName (+15 more)

### Community 69 - "Community 69"
Cohesion: 0.09
Nodes (19): MiniAppOnboarding, OwnerAdmission, SessionFailure, accountCreatedSchema, accountCreationSchema, authOpenApiDocument(), codes, errorSchema (+11 more)

### Community 70 - "Community 70"
Cohesion: 0.13
Nodes (30): admin_append_only(), admin_audit_events, admin_audit_events_realm_id_occurred_at_id_idx, admin_audit_immutable, admin_auth_receipts, admin_grants, admin_grants_operator_id_realm_id_idx, admin_operator_guard() (+22 more)

### Community 71 - "Community 71"
Cohesion: 0.08
Nodes (23): botServiceBearer(), pem(), startBotInternalTransport(), serviceFixture(), addresses, BotInternalConfigurationError, parseBotInternalConfig(), path (+15 more)

### Community 72 - "Community 72"
Cohesion: 0.10
Nodes (22): bonuses(), cases, clone(), detach(), fixture(), ids, names, own() (+14 more)

### Community 73 - "Community 73"
Cohesion: 0.06
Nodes (30): dependsOn, inputs, outputs, dependsOn, inputs, outputs, dependsOn, inputs (+22 more)

### Community 74 - "Community 74"
Cohesion: 0.15
Nodes (19): BotOnboarding, botOnboardingAckSchema, botOnboardingUpdateSchema, legacyBotOnboardingAckSchema, legacyBotOnboardingUpdateSchema, BotServiceAuthenticator, BotServiceContext, AuthRateLimiter (+11 more)

### Community 75 - "Community 75"
Cohesion: 0.10
Nodes (20): http(), http(), credited(), db, delay(), launch(), loopback(), openPalaceUI() (+12 more)

### Community 76 - "Community 76"
Cohesion: 0.15
Nodes (25): createAdminManagement(), audit(), fetch(), internalEffect(), management(), owner(), parse(), permit() (+17 more)

### Community 77 - "Community 77"
Cohesion: 0.11
Nodes (23): digest(), invalid(), inventory(), releaseGateStates(), writeEvidence(), download(), execute, policy (+15 more)

### Community 78 - "Community 78"
Cohesion: 0.08
Nodes (13): Clock, GameBotPolicy, GameEngine, GameFrontendAdapter, GameManifest, gameManifestSchema, gameVersionDescriptorSchema, identifier (+5 more)

### Community 79 - "Community 79"
Cohesion: 0.10
Nodes (19): Backend, OnboardingUpdate, webhookPath, createStagingTestResolution(), stagingTestIdentityPath, createStagingTestIdentityObserver(), identity, ObservedTestIdentity (+11 more)

### Community 80 - "Community 80"
Cohesion: 0.10
Nodes (13): certificate(), withCertificate(), AdminConfig, key, parseAdminConfig(), privateIp(), schema, integer() (+5 more)

### Community 81 - "Community 81"
Cohesion: 0.25
Nodes (26): applyCoupModuleEvent(), coins(), deadline(), end(), execute(), executeCoupModuleCommand(), executeCoupTimeout(), getCoupModuleResult() (+18 more)

### Community 82 - "Community 82"
Cohesion: 0.17
Nodes (26): eligibleNobles(), ReadonlyDeep, totalTokens(), zeroGems(), zeroTokens(), conflict(), defaultPayment(), effectiveCost() (+18 more)

### Community 84 - "Community 84"
Cohesion: 0.16
Nodes (22): auditManifests(), visit(), auditResolution(), apiDependencies, common, createPolicy(), checkImport(), externalAllowed() (+14 more)

### Community 85 - "Community 85"
Cohesion: 0.10
Nodes (10): clock, database, game, gateway, policy, reconnect, resync, server (+2 more)

### Community 86 - "Community 86"
Cohesion: 0.10
Nodes (21): adminProvisioningStatement(), createAdminProvisioningAuthority(), proofSchema, createAdminProvisioningModule(), bootstrap, { Client }, clock, crypto (+13 more)

### Community 87 - "Community 87"
Cohesion: 0.09
Nodes (24): zod@4.6.6, devDependencies, @hambazi/typescript@workspace:*, @types/node@24.13.4, @types/node-fetch@2.6.13, typescript@6.0.3, vitest@5.0.5, exports (+16 more)

### Community 88 - "Community 88"
Cohesion: 0.14
Nodes (16): digits(), KahrobaLobbyView(), LobbyIcon(), PalaceGem(), PalaceIcon(), KahrobaSheet(), key(), defaults (+8 more)

### Community 89 - "Community 89"
Cohesion: 0.12
Nodes (20): blocked, headers(), startLaptopProxy(), base, command(), compose, directory, execute (+12 more)

### Community 90 - "Community 90"
Cohesion: 0.08
Nodes (25): scripts, build, check, check:architecture, format, format:check, infra:config, infra:down (+17 more)

### Community 91 - "Community 91"
Cohesion: 0.09
Nodes (23): @hambazi/contracts@workspace:*, @hambazi/contracts, dependencies, @hambazi/contracts@workspace:*, @hambazi/shared@workspace:*, zod@4.6.6, devDependencies, @hambazi/typescript@workspace:* (+15 more)

### Community 92 - "Community 92"
Cohesion: 0.11
Nodes (21): cards, nobles, CARD_ROWS, NOBLE_ROWS, cardIdSchema, cardList, choices, DevelopmentCard (+13 more)

### Community 93 - "Community 93"
Cohesion: 0.10
Nodes (23): eslint-config-prettier, @eslint/js, globals, typescript-eslint, dependencies, eslint-config-prettier@10.1.8, @eslint/js@10.0.1, globals@17.12.0 (+15 more)

### Community 94 - "Community 94"
Cohesion: 0.10
Nodes (22): @hambazi/game-core@workspace:*, @hambazi/game-core, dependencies, @hambazi/game-core@workspace:*, zod@4.6.6, devDependencies, @hambazi/typescript@workspace:*, @types/node@24.13.4 (+14 more)

### Community 95 - "Community 95"
Cohesion: 0.14
Nodes (15): constantAdminEqual(), adminCookie, adminRequestCookie(), createAdminHttpModule(), authenticated(), csrf(), management(), policy() (+7 more)

### Community 96 - "Community 96"
Cohesion: 0.11
Nodes (6): bootstrapTelegram(), isMobile(), presentationRequested, requestLaunchPresentation(), TelegramApp, Window

### Community 97 - "Community 97"
Cohesion: 0.25
Nodes (9): fixtureOrigin, launch(), matchId, nativeEvent(), setup(), test, table(), views (+1 more)

### Community 98 - "Community 98"
Cohesion: 0.11
Nodes (17): AutomationGame, AutomationIntent, automationIntentSchema, counter, recoveryPageSchema, counter, envelope, MatchCode (+9 more)

### Community 99 - "Community 99"
Cohesion: 0.21
Nodes (17): admissionSchema, Claim, foundSchema, name, Outcome, Partition, partitionSchema, searchSchema (+9 more)

### Community 100 - "Community 100"
Cohesion: 0.10
Nodes (16): PublicNamesPort, PublicNamesRepository, publicNamesService(), createPublicNamesRepository(), createPublicNamesPort(), a, admin, api (+8 more)

### Community 101 - "Community 101"
Cohesion: 0.13
Nodes (11): botDescription, configureBotDescription(), configureMiniAppMenu(), BotRuntimeConfig, BotRuntimeConfigurationError, parseBotRuntimeConfig(), path, privateIps (+3 more)

### Community 102 - "Community 102"
Cohesion: 0.11
Nodes (21): description, devDependencies, eslint@10.10.0, @hambazi/eslint@workspace:*, prettier@3.9.6, turbo@2.10.12, vitest@5.0.5, yaml@2.9.1 (+13 more)

### Community 103 - "Community 103"
Cohesion: 0.10
Nodes (21): dependencies, @hambazi/game-core@workspace:*, zod@4.6.6, devDependencies, @hambazi/typescript@workspace:*, @types/node@24.13.4, typescript@6.0.3, vitest@5.0.5 (+13 more)

### Community 104 - "Community 104"
Cohesion: 0.10
Nodes (18): compilerOptions, composite, declaration, declarationMap, sourceMap, extends, compilerOptions, noEmit (+10 more)

### Community 105 - "Community 105"
Cohesion: 0.20
Nodes (18): account(), Actor, actor(), attemptMove(), command(), durable(), finish(), launch() (+10 more)

### Community 106 - "Community 106"
Cohesion: 0.11
Nodes (19): dependencies, zod@4.6.6, devDependencies, @hambazi/typescript@workspace:*, @types/node@24.13.4, typescript@6.0.3, vitest@5.0.5, exports (+11 more)

### Community 107 - "Community 107"
Cohesion: 0.11
Nodes (19): dependencies, zod@4.6.6, devDependencies, @hambazi/typescript@workspace:*, @types/node@24.13.4, typescript@6.0.3, vitest@5.0.5, exports (+11 more)

### Community 108 - "Community 108"
Cohesion: 0.11
Nodes (19): import, types, import, types, exports, ./auth, ./chat, ./health (+11 more)

### Community 109 - "Community 109"
Cohesion: 0.12
Nodes (18): @types/node, devDependencies, @types/node@24.13.4, typescript@6.0.3, vitest@5.0.5, exports, ./base.json, ./library.json (+10 more)

### Community 110 - "Community 110"
Cohesion: 0.13
Nodes (12): kahrobaMatchDescriptor(), installSharedFinalRound(), a, admin, b, options, rules, kahrobaRulesSchema (+4 more)

### Community 111 - "Community 111"
Cohesion: 0.14
Nodes (19): buttonCheckVersion(), buttonParams(), buttonState(), getBackgroundColor(), getBottomBarColor(), isColorDark(), onThemeChanged(), parseColorToHex() (+11 more)

### Community 112 - "Community 112"
Cohesion: 0.12
Nodes (19): networks, networks, subnet, gw_priority, ipam, ipv4_address, name, config (+11 more)

### Community 113 - "Community 113"
Cohesion: 0.25
Nodes (17): atomicJson(), automaticRenewal(), check(), digest(), main(), verify(), normalRenewalExpiry(), privateBytes() (+9 more)

### Community 114 - "Community 114"
Cohesion: 0.23
Nodes (14): upcastKahrobaEvent(), kahrobaCommandSchema, kahrobaDescriptor, kahrobaEventSchema, kahrobaManifest, KahrobaState, getKahrobaReconnectView(), kahrobaFrontendAdapter (+6 more)

### Community 115 - "Community 115"
Cohesion: 0.11
Nodes (18): compilerOptions, exactOptionalPropertyTypes, forceConsistentCasingInFileNames, isolatedModules, lib, module, moduleDetection, moduleResolution (+10 more)

### Community 116 - "Community 116"
Cohesion: 0.12
Nodes (7): isolatedKahrobaCatalog, kahrobaFixture(), active(), stored(), kahrobaRules, kahrobaSessions(), telegramSequence

### Community 117 - "Community 117"
Cohesion: 0.14
Nodes (16): AdmissionCode, commitReservationSchema, executableDescriptorSchema, matchmakingFoundIntentSchema, name, ReservationIntent, reservationReferenceSchema, reservationSchema (+8 more)

### Community 118 - "Community 118"
Cohesion: 0.21
Nodes (13): architecture(), base, browser, node, api(), fixtures, linter(), messages() (+5 more)

### Community 119 - "Community 119"
Cohesion: 0.18
Nodes (12): matchReadySchema, action(), PublicLobby, PublicLobbyPort, PublicLobbyRepository, publicLobbySchema, publicLobbyService(), hostLifecycle() (+4 more)

### Community 120 - "Community 120"
Cohesion: 0.12
Nodes (16): scripts, admin:owner:backup, admin:owner:restore-test, admin:owner:staging, admin:provision, build, contract:check, contract:generate (+8 more)

### Community 121 - "Community 121"
Cohesion: 0.12
Nodes (16): interval, retries, start_period, test, timeout, command, entrypoint, healthcheck (+8 more)

### Community 122 - "Community 122"
Cohesion: 0.22
Nodes (13): AdmissionFault, admissionService(), actor(), eligible(), parse(), safe(), createAdmissionRepository(), expire() (+5 more)

### Community 123 - "Community 123"
Cohesion: 0.22
Nodes (14): "game_results", game_results_user_id_game_id_created_at_idx, game_results_immutable, game_results_no_truncate, match_results, match_results_event_id_key, match_results_immutable, match_results_no_truncate (+6 more)

### Community 124 - "Community 124"
Cohesion: 0.20
Nodes (5): AdmissionTicket, MatchAdmissionPort, Credentials, Queue, fixture()

### Community 125 - "Community 125"
Cohesion: 0.21
Nodes (9): ExecutableDescriptor, Code, PrivateRoomMatch, PrivateRoomMatchRepository, privateRoomReadinessSchema, uuid, MatchProcessingPort, roomCommandSchema (+1 more)

### Community 126 - "Community 126"
Cohesion: 0.18
Nodes (6): createGateway(), digest(), equalSecret(), GatewayEnv, methods, env

### Community 127 - "Community 127"
Cohesion: 0.15
Nodes (13): networks, networks, external, name, networks, egress, private, external (+5 more)

### Community 128 - "Community 128"
Cohesion: 0.14
Nodes (14): cap_drop, command, image, platform, profiles, pull_policy, read_only, restart (+6 more)

### Community 129 - "Community 129"
Cohesion: 0.14
Nodes (14): cap_drop, entrypoint, image, platform, profiles, pull_policy, read_only, restart (+6 more)

### Community 130 - "Community 130"
Cohesion: 0.19
Nodes (11): capacityDatabaseActivity(), capacityResources(), args, { createClient }, failureResources(), firstPoolResourceWork, pg, redisHealth() (+3 more)

### Community 131 - "Community 131"
Cohesion: 0.14
Nodes (13): allowBuilds, argon2, msgpackr-extract, prisma, @prisma/engines, overrides, brace-expansion@5, fast-uri@3 (+5 more)

### Community 132 - "Community 132"
Cohesion: 0.24
Nodes (10): createMatchmaking(), limit(), refresh(), safe(), session(), settle(), sync(), unwrap() (+2 more)

### Community 133 - "Community 133"
Cohesion: 0.15
Nodes (13): web, cap_drop, image, platform, pull_policy, read_only, restart, security_opt (+5 more)

### Community 134 - "Community 134"
Cohesion: 0.30
Nodes (6): botHealthOperation(), content(), createApiHealth(), healthOpenApiDocument(), createServiceHealth(), healthPaths

### Community 135 - "Community 135"
Cohesion: 0.27
Nodes (8): invitePreviewSchema, inviteResponseSchema, mainInviteResponseSchema, roomAckSchema, roomResponseSchema, RoomsHttpDependencies, RoomsRate, RoomsRateDecision

### Community 136 - "Community 136"
Cohesion: 0.17
Nodes (12): scripts, build, dev, dev:kahroba, dev:preview, preview, test, test:browser (+4 more)

### Community 137 - "Community 137"
Cohesion: 0.17
Nodes (12): cap_drop, image, platform, pull_policy, read_only, restart, security_opt, stop_grace_period (+4 more)

### Community 138 - "Community 138"
Cohesion: 0.17
Nodes (12): cap_drop, image, platform, pull_policy, read_only, restart, security_opt, stop_grace_period (+4 more)

### Community 139 - "Community 139"
Cohesion: 0.17
Nodes (12): cap_drop, entrypoint, image, platform, pull_policy, read_only, restart, security_opt (+4 more)

### Community 140 - "Community 140"
Cohesion: 0.17
Nodes (12): worker, cap_drop, image, platform, pull_policy, read_only, restart, security_opt (+4 more)

### Community 141 - "Community 141"
Cohesion: 0.23
Nodes (9): CommonConfig, ConfigurationError, connection(), Field, origin(), parseRuntimeConfig(), RuntimeConfig, RuntimeRole (+1 more)

### Community 142 - "Community 142"
Cohesion: 0.26
Nodes (10): databaseOwners, isComposition(), isTest(), architecturePlugin(), queryShape(), delegates, key(), literal() (+2 more)

### Community 143 - "Community 143"
Cohesion: 0.18
Nodes (9): compilerOptions, noEmit, extends, include, compilerOptions, noEmit, extends, include (+1 more)

### Community 144 - "Community 144"
Cohesion: 0.29
Nodes (8): code, game(), http, io, reset(), room(), snapshot(), userId()

### Community 145 - "Community 145"
Cohesion: 0.18
Nodes (11): cap_drop, image, platform, read_only, restart, security_opt, stop_grace_period, stop_signal (+3 more)

### Community 146 - "Community 146"
Cohesion: 0.18
Nodes (11): cap_drop, image, platform, read_only, restart, security_opt, stop_grace_period, stop_signal (+3 more)

### Community 147 - "Community 147"
Cohesion: 0.18
Nodes (11): web, cap_drop, image, platform, read_only, restart, security_opt, stop_grace_period (+3 more)

### Community 148 - "Community 148"
Cohesion: 0.18
Nodes (11): worker, cap_drop, image, platform, read_only, restart, security_opt, stop_grace_period (+3 more)

### Community 149 - "Community 149"
Cohesion: 0.24
Nodes (11): logging, logging, driver, options, compress, max-file, max-size, logging (+3 more)

### Community 150 - "Community 150"
Cohesion: 0.47
Nodes (11): volumes, create_host_path, volumes, volumes, volumes, bind, read_only, source (+3 more)

### Community 151 - "Community 151"
Cohesion: 0.44
Nodes (10): assert(), containers, delay(), deploy(), drainAcceptedRequest(), envFile(), root, run() (+2 more)

### Community 152 - "Community 152"
Cohesion: 0.38
Nodes (9): capacityConnectionProfile(), capacityDriverBudgetSeconds(), capacityFixtureLimits(), capacityHttpRetryAllowed(), capacityPopulationGates(), capacityProfile(), latencyGates(), normalCapacityGates() (+1 more)

### Community 153 - "Community 153"
Cohesion: 0.18
Nodes (7): AuthConfigurationError, AuthRuntimeConfig, binding, Field, keyId, keysSchema, shape

### Community 154 - "Community 154"
Cohesion: 0.33
Nodes (10): bot_flow_guard, bot_onboarding_flows, bot_onboarding_flows_bot_id_telegram_user_id_key, bot_onboarding_flows_expires_at_idx, bot_receipt_guard, bot_update_receipts, bot_update_receipts_bot_id_update_id_key, bot_update_receipts_expires_at_idx (+2 more)

### Community 155 - "Community 155"
Cohesion: 0.35
Nodes (10): guard_match_admission(), guard_match_reservation(), match_admissions, match_admissions_active_key_key, match_admissions_actor_user_id_command_id_key, match_admissions_guard, match_admissions_reservation_id_idx, match_reservations (+2 more)

### Community 156 - "Community 156"
Cohesion: 0.18
Nodes (9): admin, api, database, matchId, options, sessionCommandId, sessionId, userId (+1 more)

### Community 157 - "Community 157"
Cohesion: 0.27
Nodes (9): compareIds(), coverage(), kahrobaBotPolicy, returnsFor(), KahrobaTimeoutPolicy, GemVector, KahrobaCommand, TokenVector (+1 more)

### Community 159 - "Community 159"
Cohesion: 0.22
Nodes (7): botToken, fields(), fixedResult, policy, rejected, verifier, date()

### Community 160 - "Community 160"
Cohesion: 0.20
Nodes (9): a, admin, b, Client, config, games, invites, pg (+1 more)

### Community 161 - "Community 161"
Cohesion: 0.20
Nodes (9): compilerOptions, declaration, declarationMap, noEmit, outDir, rootDir, sourceMap, extends (+1 more)

### Community 162 - "Community 162"
Cohesion: 0.20
Nodes (7): extends, include, ./tsconfig.json, extends, include, extends, include

### Community 163 - "Community 163"
Cohesion: 0.20
Nodes (9): compilerOptions, declaration, declarationMap, noEmit, outDir, rootDir, sourceMap, extends (+1 more)

### Community 164 - "Community 164"
Cohesion: 0.20
Nodes (9): compilerOptions, declaration, declarationMap, noEmit, outDir, rootDir, sourceMap, extends (+1 more)

### Community 165 - "Community 165"
Cohesion: 0.20
Nodes (9): compilerOptions, declaration, declarationMap, noEmit, outDir, rootDir, sourceMap, extends (+1 more)

### Community 166 - "Community 166"
Cohesion: 0.20
Nodes (9): networks, private, command, name, internal, services, postgres, volumes (+1 more)

### Community 167 - "Community 167"
Cohesion: 0.20
Nodes (10): command, entrypoint, image, platform, profiles, pull_policy, restart, stop_grace_period (+2 more)

### Community 168 - "Community 168"
Cohesion: 0.33
Nodes (5): createRealtimeConsumer(), realtimeJobProcessor(), event, reportTelemetry(), Telemetry

### Community 169 - "Community 169"
Cohesion: 0.22
Nodes (9): x-runtime, cap_drop, platform, read_only, restart, security_opt, stop_signal, tmpfs (+1 more)

### Community 170 - "Community 170"
Cohesion: 0.22
Nodes (8): compilerOptions, noEmit, outDir, rootDir, tsBuildInfoFile, types, extends, include

### Community 171 - "Community 171"
Cohesion: 0.33
Nodes (8): "game_admin_effects", game_admin_effects_immutable, "match_admin_effects", match_admin_effects_immutable, "room_admin_effects", room_admin_effects_immutable, "user_admin_effects", user_admin_effects_immutable

### Community 172 - "Community 172"
Cohesion: 0.22
Nodes (8): compilerOptions, noEmit, outDir, rootDir, tsBuildInfoFile, types, extends, include

### Community 173 - "Community 173"
Cohesion: 0.22
Nodes (8): compilerOptions, lib, noEmit, outDir, rootDir, tsBuildInfoFile, extends, include

### Community 174 - "Community 174"
Cohesion: 0.22
Nodes (8): compilerOptions, lib, noEmit, outDir, rootDir, tsBuildInfoFile, extends, include

### Community 175 - "Community 175"
Cohesion: 0.22
Nodes (8): compilerOptions, noEmit, outDir, rootDir, tsBuildInfoFile, types, extends, include

### Community 176 - "Community 176"
Cohesion: 0.22
Nodes (8): compilerOptions, lib, noEmit, outDir, rootDir, tsBuildInfoFile, extends, include

### Community 177 - "Community 177"
Cohesion: 0.22
Nodes (8): endOfLine, printWidth, proseWrap, semi, singleQuote, tabWidth, trailingComma, useTabs

### Community 178 - "Community 178"
Cohesion: 0.25
Nodes (7): compilerOptions, declaration, noEmit, outDir, rootDir, extends, include

### Community 179 - "Community 179"
Cohesion: 0.25
Nodes (8): onContentSafeAreaChanged(), onSafeAreaChanged(), onViewportChanged(), onWindowResize(), setContentSafeAreaInset(), setCssProperty(), setSafeAreaInset(), setViewportHeight()

### Community 180 - "Community 180"
Cohesion: 0.39
Nodes (8): volumes, create_host_path, volumes, bind, read_only, source, target, type

### Community 181 - "Community 181"
Cohesion: 0.43
Nodes (8): env_file, env_file, format, path, env_file, env_file, env_file, env_file

### Community 182 - "Community 182"
Cohesion: 0.25
Nodes (7): compilerOptions, noEmit, outDir, rootDir, tsBuildInfoFile, extends, include

### Community 183 - "Community 183"
Cohesion: 0.25
Nodes (7): compilerOptions, noEmit, outDir, rootDir, tsBuildInfoFile, extends, include

### Community 184 - "Community 184"
Cohesion: 0.33
Nodes (5): count, gameId, leaderboardSchema, ownStatsSchema, period

### Community 186 - "Community 186"
Cohesion: 0.29
Nodes (6): name, networks, name, services, volumes, postgres-data

### Community 187 - "Community 187"
Cohesion: 0.29
Nodes (7): private, networks, aliases, external, ipv4_address, name, networks

### Community 188 - "Community 188"
Cohesion: 0.48
Nodes (6): guard_match_connection_lease(), guard_match_reconnect_policy(), match_connection_leases, match_connection_leases_guard, match_connection_leases_match_id_user_id_lease_until_idx, matches_guard_reconnect_policy

### Community 189 - "Community 189"
Cohesion: 0.52
Nodes (6): protect_user_restriction(), user_restriction_immutable, user_restrictions, user_restrictions_active_idx, user_restrictions_ended_at_expires_at_idx, user_restrictions_user_id_id_idx

### Community 190 - "Community 190"
Cohesion: 0.33
Nodes (5): binding, header, keyId, payload, seconds

### Community 191 - "Community 191"
Cohesion: 0.33
Nodes (5): compilerOptions, experimentalDecorators, noEmit, extends, include

### Community 192 - "Community 192"
Cohesion: 0.53
Nodes (4): continueAuth(), enterMatch(), launch(), signIn()

### Community 193 - "Community 193"
Cohesion: 0.53
Nodes (6): env_file, env_file, format, path, env_file, env_file

### Community 194 - "Community 194"
Cohesion: 0.33
Nodes (6): logging, logging, driver, logging, logging, logging

### Community 195 - "Community 195"
Cohesion: 0.33
Nodes (5): name, name, services, volumes, postgres-data

### Community 196 - "Community 196"
Cohesion: 0.33
Nodes (6): external, gw_priority, ipv4_address, name, networks, egress

### Community 197 - "Community 197"
Cohesion: 0.40
Nodes (5): "chat_messages", chat_messages_match_id_created_at_id_idx, chat_messages_match_id_seq_key, chat_messages_match_id_user_id_command_id_key, chat_streams

### Community 198 - "Community 198"
Cohesion: 0.60
Nodes (5): guard_session_metadata(), sessions, sessions_expires_at_idx, sessions_guard_metadata, sessions_user_id_command_id_key

### Community 199 - "Community 199"
Cohesion: 0.33
Nodes (6): compilerOptions, lib, noEmit, outDir, rootDir, tsBuildInfoFile

### Community 200 - "Community 200"
Cohesion: 0.33
Nodes (4): game, match, metadata, room

### Community 201 - "Community 201"
Cohesion: 0.40
Nodes (4): compilerOptions, noEmit, extends, include

### Community 202 - "Community 202"
Cohesion: 0.40
Nodes (4): compilerOptions, types, extends, include

### Community 203 - "Community 203"
Cohesion: 0.40
Nodes (4): compilerOptions, noEmit, extends, include

### Community 204 - "Community 204"
Cohesion: 0.40
Nodes (5): ports, host_ip, protocol, published, target

### Community 206 - "Community 206"
Cohesion: 0.40
Nodes (4): compilerOptions, noEmit, extends, include

### Community 207 - "Community 207"
Cohesion: 0.40
Nodes (4): compilerOptions, noEmit, extends, include

### Community 208 - "Community 208"
Cohesion: 0.40
Nodes (4): compilerOptions, lib, extends, include

### Community 209 - "Community 209"
Cohesion: 0.40
Nodes (4): compilerOptions, lib, extends, include

### Community 210 - "Community 210"
Cohesion: 0.40
Nodes (4): compilerOptions, lib, extends, include

### Community 211 - "Community 211"
Cohesion: 0.40
Nodes (4): compilerOptions, noEmit, extends, include

### Community 212 - "Community 212"
Cohesion: 0.50
Nodes (3): @hambazi/typescript/node.json, extends, include

### Community 213 - "Community 213"
Cohesion: 0.67
Nodes (4): format, path, env_file, env_file

### Community 214 - "Community 214"
Cohesion: 0.50
Nodes (4): logging, driver, logging, logging

### Community 216 - "Community 216"
Cohesion: 0.50
Nodes (3): @hambazi/typescript/library.json, extends, include

### Community 217 - "Community 217"
Cohesion: 0.83
Nodes (3): profile_mutation_receipts, profile_mutation_receipts_expires_at_idx, profile_mutation_receipts_user_id_command_id_key

### Community 218 - "Community 218"
Cohesion: 0.67
Nodes (3): room_command_receipts, room_command_receipts_room_id_idx, rooms_started_match_id_key

### Community 219 - "Community 219"
Cohesion: 0.50
Nodes (3): ./node.json, extends, include

### Community 221 - "Community 221"
Cohesion: 1.00
Nodes (3): urlParseHashParams(), urlParseQueryString(), urlSafeDecode()

## Knowledge Gaps
- **5 isolated node(s):** `ADR-0084`, `./node.json`, `cases`, `ids`, `names`
  These have ≤1 connection - possible missing edges. (Counts symbols only; 2251 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **51 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `createDatabase()` connect `Community 48` to `Community 0`, `Community 2`, `Community 4`, `Community 7`, `Community 13`, `Community 14`, `Community 17`, `Community 19`, `Community 21`, `Community 24`, `Community 25`, `Community 156`, `Community 31`, `Community 160`, `Community 36`, `Community 37`, `Community 38`, `Community 40`, `Community 42`, `Community 45`, `Community 50`, `Community 51`, `Community 53`, `Community 59`, `Community 65`, `Community 66`, `Community 67`, `Community 75`, `Community 85`, `Community 86`, `Community 100`, `Community 110`, `Community 116`, `Community 119`?**
  _High betweenness centrality (0.021) - this node is a cross-community bridge._
- **What connects `ADR-0084`, `./node.json`, `cases` to the rest of the system?**
  _5 weakly-connected nodes found - possible missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.03686405337781484 - nodes in this community are weakly interconnected._
- **Why does `@types/node` connect `Community 109` to `Community 103`, `Community 9`, `Community 106`, `Community 107`, `Community 91`, `Community 47`, `Community 49`, `Community 87`, `Community 27`, `Community 61`, `Community 94`?**
  _High betweenness centrality (0.020) - this node is a cross-community bridge._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.02682589131187262 - nodes in this community are weakly interconnected._
- **Why does `url()` connect `Community 32` to `Community 0`, `Community 101`?**
  _High betweenness centrality (0.018) - this node is a cross-community bridge._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.032475247524752476 - nodes in this community are weakly interconnected._