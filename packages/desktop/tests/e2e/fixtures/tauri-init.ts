/**
 * Tauri IPC shim for Playwright init scripts.
 *
 * Injected via page.addInitScript() BEFORE any page JavaScript runs. Sets up
 * window.__TAURI_MOCK_HANDLERS__ with sensible defaults for every command the
 * app calls on startup. Individual tests can override handlers after injection.
 *
 * This is the "reliable" mock path (runs before the Vite module graph fires).
 * The src/__mocks__/@tauri-apps/ module aliases are complementary -- they catch
 * anything the IIFE below misses.
 */

export function tauriInitScript(): string {
  return `(function () {
    // Handler map - tests override individual entries after page.addInitScript.
    function mockArray(name) {
      if (!Array.isArray(window[name])) {
        window[name] = [];
      }
      return window[name];
    }
    window.__TAURI_MOCK_YOUTUBE_WINDOW_VISIBLE__ = false;
    var SQLITE_LIBRARY_WINDOW_PREFIX = '__freed_e2e_sqlite_library_v1__';
    var persistedSqliteLibrary = null;
    try {
      persistedSqliteLibrary = window.name.indexOf(SQLITE_LIBRARY_WINDOW_PREFIX) === 0
        ? JSON.parse(window.name.slice(SQLITE_LIBRARY_WINDOW_PREFIX.length))
        : null;
    } catch (_) {}
    window.__TAURI_MOCK_SQLITE_LIBRARY__ = persistedSqliteLibrary || {
      active: false,
      revision: 0,
      sourceGeneration: 0,
      sourceRevision: 0,
      sourceDigest: '',
      expectedItemCount: 0,
      shell: null,
      items: {},
    };
    function persistSqliteState() {
      try {
        window.name = SQLITE_LIBRARY_WINDOW_PREFIX + JSON.stringify(sqliteState());
      } catch (error) {
        window.__TAURI_MOCK_SQLITE_PERSIST_ERROR__ = String(error);
        // Large performance fixtures may exceed browser storage. They do not
        // rely on reload persistence, so keep their authoritative mock in RAM.
      }
    }
    function sqliteState() {
      return window.__TAURI_MOCK_SQLITE_LIBRARY__;
    }
    function sqliteItemState(item) {
      return item && item.userState ? item.userState : {};
    }
    function normalizedLibraryCloudIdentity() {
      var state = sqliteState();
      var items = Object.values(state.items).filter(function(item) { return !item.__deleted; });
      return {
        format: 'freed_normalized_checkpoint_export_v2',
        protocolVersion: 2,
        libraryId: '2'.repeat(64),
        authorityEpoch: '3'.repeat(64),
        writerId: '6'.repeat(64),
        sourceRevision: state.sourceRevision,
        causalFrontierDigest: 'a'.repeat(64),
        recordCount: items.length + 1,
        itemCount: items.length,
        localActorId: '6'.repeat(64),
      };
    }
    function sqliteFacetSummary() {
      var items = Object.values(sqliteState().items).filter(function(item) { return !item.__deleted; });
      var tags = new Set();
      items.forEach(function(item) {
        (sqliteItemState(item).tags || []).forEach(function(tag) { tags.add(tag); });
      });
      return {
        archivedCount: items.filter(function(item) { return !!sqliteItemState(item).archived; }).length,
        sampleItemCount: items.filter(function(item) { return !!item.sampleData; }).length,
        savedArchivedCount: items.filter(function(item) {
          var user = sqliteItemState(item);
          return !!user.saved && !!user.archived;
        }).length,
        savedCount: items.filter(function(item) { return !!sqliteItemState(item).saved; }).length,
        savedPlatformCount: new Set(items.filter(function(item) {
          return !!sqliteItemState(item).saved;
        }).map(function(item) { return item.platform; })).size,
        tags: Array.from(tags).sort(),
        totalCount: items.length,
      };
    }
    window.__FREED_E2E_NORMALIZED_CAPTURE_ITEMS__ = function(items) {
      var state = sqliteState();
      (items || []).forEach(function(item) {
        state.items[item.globalId] = JSON.parse(JSON.stringify(item));
      });
      state.revision += 1;
      persistSqliteState();
    };
    function sqliteMutateItems(args) {
      var state = sqliteState();
      var request = args && args.request ? args.request : {};
      var ids = request.ids || [];
      var candidates = ids.length > 0
        ? ids.map(function(id) { return state.items[id]; }).filter(Boolean)
        : Object.values(state.items);
      var affected = 0;
      candidates.forEach(function(item) {
        if (!item || item.__deleted) return;
        if (request.platform && item.platform !== request.platform) return;
        if (request.feedUrl && (!item.rssSource || item.rssSource.feedUrl !== request.feedUrl)) return;
        var user = item.userState || (item.userState = {});
        switch (request.mutation) {
          case 'mark_read':
          case 'mark_all_read':
            if (user.readAt == null) user.readAt = request.timestampMs;
            break;
          case 'toggle_saved':
            user.saved = !user.saved;
            if (user.saved) { user.savedAt = request.timestampMs; user.archived = false; delete user.archivedAt; }
            else delete user.savedAt;
            break;
          case 'toggle_archived':
            if (user.saved) return;
            user.archived = !user.archived;
            if (user.archived) user.archivedAt = request.timestampMs;
            else delete user.archivedAt;
            break;
          case 'archive':
          case 'archive_all_read_unsaved':
            if (user.saved || user.hidden || user.readAt == null) return;
            user.archived = true; user.archivedAt = user.archivedAt || request.timestampMs;
            break;
          case 'toggle_liked':
            user.liked = !user.liked;
            if (user.liked) user.likedAt = request.timestampMs;
            else { delete user.likedAt; delete user.likedSyncedAt; }
            break;
          case 'confirm_liked': user.likedSyncedAt = request.timestampMs; break;
          case 'confirm_seen': user.seenSyncedAt = request.timestampMs; break;
          case 'unarchive_saved':
            if (!user.saved || !user.archived) return;
            user.archived = false; delete user.archivedAt;
            break;
          case 'delete_all_archived':
            if (!user.archived || user.saved) return;
            item.__deleted = true;
            break;
          case 'prune_archived':
            if (!user.archived || user.saved || user.archivedAt == null || user.archivedAt > request.timestampMs - (request.maxAgeMs || 0)) return;
            item.__deleted = true;
            break;
          case 'delete_rss':
            if (item.platform !== 'rss') return;
            item.__deleted = true;
            break;
          case 'delete': item.__deleted = true; break;
          case 'clear_sample':
            if (!item.sampleData) return;
            item.__deleted = true;
            break;
          default: return;
        }
        affected += 1;
      });
      state.revision += 1;
      persistSqliteState();
      return affected;
    }
    window.__FREED_E2E_NORMALIZED_MUTATE_ITEMS__ = function(request) {
      return sqliteMutateItems({ request: request });
    };
    function sqliteFeedCard(item) {
      var user = sqliteItemState(item);
      var content = item.content || {};
      var engagement = item.engagement || {};
      var event = item.eventCandidate || {};
      return {
        archived: !!user.archived,
        authorAvatarUrl: item.author && item.author.avatarUrl || null,
        authorDisplayName: item.author && item.author.displayName || null,
        authorHandle: item.author && item.author.handle || null,
        authorId: item.author && item.author.id || null,
        capturedAt: item.capturedAt == null ? null : item.capturedAt,
        contentSignalTags: item.contentSignals && item.contentSignals.tags || [],
        contentText: content.text || null,
        contentType: item.contentType || null,
        engagementComments: engagement.comments == null ? null : engagement.comments,
        engagementLikes: engagement.likes == null ? null : engagement.likes,
        eventConfidenceBasisPoints: event.confidence == null ? null : Math.round(event.confidence * 10000),
        eventStartsAt: event.startsAt == null ? null : event.startsAt,
        globalId: item.globalId,
        liked: user.liked == null ? null : !!user.liked,
        likedAt: user.likedAt == null ? null : user.likedAt,
        likedSyncedAt: user.likedSyncedAt == null ? null : user.likedSyncedAt,
        linkPreviewTitle: content.linkPreview && content.linkPreview.title || null,
        locationName: item.location && item.location.name || null,
        mediaTypes: content.mediaTypes || [],
        mediaUrls: content.mediaUrls || [],
        platform: item.platform || null,
        publishedAt: item.publishedAt == null ? null : item.publishedAt,
        readAt: user.readAt == null ? null : user.readAt,
        readingTimeMinutes: item.preservedContent && item.preservedContent.readingTime || null,
        saved: !!user.saved,
        sourceUrl: item.sourceUrl || content.linkPreview && content.linkPreview.url || null,
        tags: user.tags || [],
      };
    }
    function sqliteQueryItems(request) {
      var filter = request.filter || {};
      return Object.values(sqliteState().items).filter(function(item) {
        if (!item || item.__deleted) return false;
        var user = sqliteItemState(item);
        if (!!user.archived !== !!filter.archivedOnly) return false;
        if (!filter.showHidden && !!user.hidden) return false;
        if (filter.savedOnly && !user.saved) return false;
        if (filter.platform && item.platform !== filter.platform) return false;
        if (filter.authorId && (!item.author || item.author.id !== filter.authorId)) return false;
        if (filter.feedUrl && (!item.rssSource || item.rssSource.feedUrl !== filter.feedUrl)) return false;
        var tags = user.tags || [];
        if ((filter.tags || []).length > 0 && !filter.tags.some(function(tag) { return tags.includes(tag); })) return false;
        var signals = item.contentSignals && item.contentSignals.tags || [];
        if ((filter.signals || []).length > 0 && !filter.signals.some(function(signal) { return signals.includes(signal); })) return false;
        if (filter.socialContentFilter === 'stories' && item.contentType !== 'story') return false;
        if (filter.socialContentFilter === 'posts' && item.contentType === 'story') return false;
        return true;
      }).sort(function(left, right) {
        return (right.publishedAt || 0) - (left.publishedAt || 0) || left.globalId.localeCompare(right.globalId);
      });
    }
    function sqliteNormalizedQuery(args) {
      var request = args && args.request || {};
      var state = sqliteState();
      var source = {
        generationId: 'd'.repeat(64),
        projectionRevision: Math.max(0, state.revision || 0),
        transitionSequence: Math.max(0, state.sourceGeneration || 0),
      };
      if (request.queryId === 'library_facet_summary_v1') {
        var liveItems = Object.values(state.items).filter(function(item) {
          return item && !item.__deleted;
        });
        var platformCounts = {};
        var tags = new Set();
        liveItems.forEach(function(item) {
          var user = sqliteItemState(item);
          var platform = item.platform || 'unknown';
          var counts = platformCounts[platform] || {
            archivableCount: 0,
            latestCapturedAt: null,
            latestPublishedAt: null,
            platform: platform,
            totalCount: 0,
            unreadCount: 0,
          };
          counts.totalCount += 1;
          counts.latestCapturedAt = Math.max(counts.latestCapturedAt || 0, item.capturedAt || 0) || null;
          counts.latestPublishedAt = Math.max(counts.latestPublishedAt || 0, item.publishedAt || 0) || null;
          if (user.readAt == null) counts.unreadCount += 1;
          if (user.readAt != null && !user.saved && !user.archived && !user.hidden) {
            counts.archivableCount += 1;
          }
          platformCounts[platform] = counts;
          (user.tags || []).forEach(function(tag) { tags.add(tag); });
        });
        var shell = state.shell || {};
        var feeds = Object.values(shell.feeds || {});
        var persons = Object.values(shell.persons || {});
        var accounts = Object.values(shell.accounts || {});
        var contactAccounts = accounts.filter(function(account) {
          return account.kind === 'contact' && account.provider === 'google_contacts';
        });
        var personIds = new Set(persons.map(function(person) { return person.id; }));
        return {
          queryId: request.queryId,
          schemaVersion: request.schemaVersion,
          source: source,
          summary: {
            archivedCount: liveItems.filter(function(item) { return !!sqliteItemState(item).archived; }).length,
            archivableCount: liveItems.filter(function(item) {
              var user = sqliteItemState(item);
              return user.readAt != null && !user.saved && !user.archived && !user.hidden;
            }).length,
            contactAccountCount: contactAccounts.length,
            contactLinkedPersonCount: new Set(contactAccounts.filter(function(account) {
              return account.personId && personIds.has(account.personId);
            }).map(function(account) { return account.personId; })).size,
            enabledRssFeedCount: feeds.filter(function(feed) { return feed.enabled !== false; }).length,
            friendPersonCount: persons.filter(function(person) { return person.relationshipStatus === 'friend'; }).length,
            latestContactImportedAt: contactAccounts.reduce(function(latest, account) {
              return Math.max(latest, account.importedAt || account.lastSeenAt || account.createdAt || 0);
            }, 0) || null,
            latestRssFeedFetchedAt: feeds.filter(function(feed) {
              return feed.enabled !== false;
            }).reduce(function(latest, feed) {
              return Math.max(latest, feed.lastFetched || 0);
            }, 0) || null,
            platformCounts: Object.values(platformCounts).sort(function(left, right) {
              return left.platform.localeCompare(right.platform);
            }),
            rssFeedCount: feeds.length,
            sampleAccountCount: accounts.filter(function(account) { return !!account.sampleDataFingerprint; }).length,
            sampleFeedCount: feeds.filter(function(feed) { return !!feed.sampleDataFingerprint; }).length,
            sampleItemCount: liveItems.filter(function(item) { return !!item.sampleDataFingerprint; }).length,
            samplePersonCount: persons.filter(function(person) { return !!person.sampleDataFingerprint; }).length,
            savedArchivedCount: liveItems.filter(function(item) {
              var user = sqliteItemState(item);
              return !!user.saved && !!user.archived;
            }).length,
            savedCount: liveItems.filter(function(item) { return !!sqliteItemState(item).saved; }).length,
            savedPlatformCount: new Set(liveItems.filter(function(item) {
              return !!sqliteItemState(item).saved;
            }).map(function(item) { return item.platform || 'unknown'; })).size,
            socialAccountCount: accounts.filter(function(account) { return account.kind === 'social'; }).length,
            tags: Array.from(tags).sort(),
            totalCount: liveItems.length,
            unreadCount: liveItems.filter(function(item) { return sqliteItemState(item).readAt == null; }).length,
          },
        };
      }
      if (request.queryId === 'preferences_snapshot_v1') {
        return {
          queryId: request.queryId,
          rows: [],
          schemaVersion: request.schemaVersion,
          source: source,
        };
      }
      if (request.queryId === 'account_detail_v1') {
        var shell = state.shell || {};
        var account = shell.accounts && shell.accounts[request.accountId] || null;
        var fingerprint = account && account.sampleDataFingerprint || null;
        return {
          account: account ? {
            address: account.address == null ? null : account.address,
            avatarUrl: account.avatarUrl == null ? null : account.avatarUrl,
            createdAt: account.createdAt,
            discoveredFrom: account.discoveredFrom,
            displayName: account.displayName == null ? null : account.displayName,
            email: account.email == null ? null : account.email,
            externalId: account.externalId,
            firstSeenAt: account.firstSeenAt,
            followRosterActive: account.followRosterActive == null ? null : account.followRosterActive,
            followRosterRoles: (account.followRosterRoles || []).slice().sort(),
            followRosterSyncedAt: account.followRosterSyncedAt == null ? null : account.followRosterSyncedAt,
            handle: account.handle == null ? null : account.handle,
            id: account.id,
            importedAt: account.importedAt == null ? null : account.importedAt,
            kind: account.kind,
            lastSeenAt: account.lastSeenAt,
            personId: account.personId == null ? null : account.personId,
            phone: account.phone == null ? null : account.phone,
            profileUrl: account.profileUrl == null ? null : account.profileUrl,
            provider: account.provider,
            sampleBatchId: fingerprint ? fingerprint.batchId : null,
            sampleGeneratedAt: fingerprint ? fingerprint.generatedAt : null,
            sampleGeneratorVersion: fingerprint ? fingerprint.generatorVersion : null,
            updatedAt: account.updatedAt,
          } : null,
          queryId: request.queryId,
          schemaVersion: request.schemaVersion,
          source: source,
        };
      }
      if (request.queryId === 'item_detail_v1') {
        var item = state.items[request.globalId];
        return {
          item: item && !item.__deleted ? {
            card: sqliteFeedCard(item),
            contentBody: {
              blobDigest: null,
              storage: item.content && item.content.text ? 'inline' : 'none',
            },
            preservedBody: {
              blobDigest: null,
              storage: 'none',
            },
          } : null,
          queryId: request.queryId,
          schemaVersion: request.schemaVersion,
          source: source,
        };
      }
      if (request.queryId === 'background_item_page_v1') {
        var backgroundRows = Object.values(sqliteState().items)
          .filter(function(item) { return item && !item.__deleted; })
          .sort(function(left, right) {
            return left.globalId.localeCompare(right.globalId);
          })
          .slice(0, request.limit || 64)
          .map(function(item) {
            var rss = item.rssSource || null;
            return Object.assign({}, sqliteFeedCard(item), {
              hidden: !!sqliteItemState(item).hidden,
              rssSource: rss ? {
                feedTitle: rss.feedTitle || '',
                feedUrl: rss.feedUrl,
                siteUrl: rss.siteUrl || '',
              } : null,
              sampleDataFingerprint: item.sampleDataFingerprint || null,
            });
          });
        return {
          nextCursor: null,
          queryId: request.queryId,
          rows: backgroundRows,
          schemaVersion: request.schemaVersion,
          source: source,
        };
      }
      if (request.queryId === 'provider_media_page_v1') {
        var providerRows = Object.values(sqliteState().items).filter(function(item) {
          if (!item || item.__deleted) return false;
          var user = sqliteItemState(item);
          if (user.hidden || request.savedOnly && !user.saved) return false;
          return request.provider === 'youtube' && request.savedOnly
            ? [item.sourceUrl, item.content && item.content.linkPreview && item.content.linkPreview.url]
                .some(function(value) { return typeof value === 'string' && /(?:youtube(?:-nocookie)?\.com|youtu\.be)\//i.test(value); })
            : item.platform === request.provider;
        }).sort(function(left, right) {
          return left.globalId.localeCompare(right.globalId);
        }).slice(0, request.limit || 64).map(function(item) {
          return Object.assign({}, sqliteFeedCard(item), {
            fbGroup: item.fbGroup || null,
            linkUrl: item.content && item.content.linkPreview && item.content.linkPreview.url || null,
          });
        });
        return {
          nextCursor: null,
          queryId: request.queryId,
          rows: providerRows,
          schemaVersion: request.schemaVersion,
          source: source,
        };
      }
      if (request.queryId !== 'feed_browse_page_v3' && request.queryId !== 'saved_feed_page_v2') {
        return null;
      }
      var candidates = sqliteQueryItems(request);
      var rows = candidates.slice(0, request.limit || 128).map(sqliteFeedCard);
      if (request.queryId === 'saved_feed_page_v2') {
        return {
          filter: request.filter,
          nextCursor: null,
          nextOrder: null,
          previousCursor: null,
          previousOrder: null,
          queryId: request.queryId,
          rows: rows.map(function(row, index) {
            return Object.assign({}, row, {
              savedAt: sqliteItemState(candidates[index]).savedAt || null,
            });
          }),
          schemaVersion: request.schemaVersion,
          sortMode: request.sortMode,
          source: source,
          totalCount: candidates.length,
        };
      }
      return {
        filter: request.filter,
        friendsPredicateSchemaVersion: request.friendsPredicateSchemaVersion,
        identityMode: request.identityMode,
        nextCursor: null,
        nextOrder: null,
        previousCursor: null,
        previousOrder: null,
        queryId: request.queryId,
        rankingClockMs: request.rankingClockMs,
        recommendationOrderSchemaVersion: request.recommendationOrderSchemaVersion,
        rows: rows,
        schemaVersion: request.schemaVersion,
        source: source,
        totalCount: candidates.length,
      };
    }
    window.__TAURI_MOCK_HANDLERS__ = {
      ensure_fresh_normalized_desktop_library: () => {
        sqliteState().active = true;
        persistSqliteState();
        return true;
      },
      sqlite_library_status: () => {
        var state = sqliteState();
        return state.active ? {
          active: true,
          revision: state.revision,
          expectedItemCount: state.expectedItemCount,
          importedItemCount: Object.keys(state.items).length,
          sourceGeneration: state.sourceGeneration,
          sourceRevision: state.sourceRevision,
          sourceDigest: state.sourceDigest,
        } : null;
      },
      describe_normalized_library_cloud_identity: normalizedLibraryCloudIdentity,
      read_sqlite_library_facet_summary: sqliteFacetSummary,
      query_normalized_library: sqliteNormalizedQuery,
      set_sqlite_library_cloud_writer_admission: (args) => {
        var request = args.request;
        var admission = {
          configured: true,
          allowed: request.localWriterId === request.activeWriterId,
          localWriterId: request.localWriterId,
          activeWriterId: request.activeWriterId,
          storageEpoch: request.storageEpoch,
          controlRevision: request.controlRevision,
          verifiedAtMs: request.verifiedAtMs,
        };
        window.__TAURI_MOCK_SQLITE_WRITER_ADMISSION__ = admission;
        return admission;
      },
      sqlite_library_cloud_writer_admission_status: () =>
        window.__TAURI_MOCK_SQLITE_WRITER_ADMISSION__ || {
          configured: false,
          allowed: true,
          localWriterId: null,
          activeWriterId: null,
          storageEpoch: null,
          controlRevision: null,
          verifiedAtMs: null,
        },
      normalized_library_follower_runtime_status: () => ({
        state: 'awaiting_checkpoint',
        libraryId: null,
        authorityEpochId: null,
        actorId: null,
        checkpointGeneration: null,
        sourceRevision: null,
        pendingIntentCount: 0,
        publishedIntentCount: 0,
        importedResultCount: 0,
      }),
      normalized_library_follower_transport_context: () => ({
        actorId: '11'.repeat(32),
        libraryId: '22'.repeat(32),
        nextIntentActorCounter: 1,
        nextResultSequence: 1,
        previousIntentSegmentDigest: null,
        previousResultSegmentDigest: null,
        schemaVersion: 2,
        storageEpochId: '33'.repeat(32),
      }),
      page_normalized_library_follower_transport: (args) => {
        var page = args.page || {};
        return {
          actorId: page.actorId,
          canonicalEnvelopes: [],
          done: true,
          firstActorCounter: page.firstActorCounter,
          lastActorCounter: null,
          schemaVersion: 2,
        };
      },
      record_normalized_library_follower_intent_transport_publication: (args) => {
        var publication = args.publication || {};
        return {
          actorId: publication.actorId,
          firstActorCounter: publication.firstActorCounter,
          lastActorCounter: publication.lastActorCounter,
          newlyPublishedTransactionCount: 1,
          nextActorCounter: publication.lastActorCounter + 1,
          publishedAt: publication.publishedAt,
          semanticSegmentDigest: publication.semanticSegmentDigest,
          storedSegmentDigest: publication.storedSegmentDigest,
        };
      },
      import_normalized_library_follower_result_transport_segment: (args) => {
        var publication = args.publication || {};
        var records = publication.records || [];
        return {
          acceptedTransactionCount: records.length,
          actorId: publication.actorId,
          firstResultSequence: 1,
          lastResultSequence: records.length,
          nextResultSequence: records.length + 1,
          receivedAt: publication.receivedAt,
          rejectedTransactionCount: 0,
          resultCount: records.length,
          semanticSegmentDigest: publication.semanticSegmentDigest,
          storedSegmentDigest: publication.storedSegmentDigest,
        };
      },
      fetch_url: () => '',
      google_api_request: () => ({ status: 200, headers: [['content-type', 'application/json']], bodyB64: btoa('{"connections":[],"nextSyncToken":"test-sync-token"}') }),
      google_oauth_proxy_request: () => ({ status: 200, headers: [['content-type', 'application/json']], bodyB64: btoa('{"access_token":"test-access-token","refresh_token":"test-refresh-token","expires_in":3600}') }),
      google_drive_request: () => ({ status: 200, headers: [['content-type', 'application/json']], bodyB64: btoa('{"files":[]}') }),
      fetch_binary_url: () => [],
      sha256_file: () => '',
      download_local_ai_model_file: (args) => args && args.request ? args.request.expectedSizeBytes || 0 : 0,
      cancel_local_ai_model_download: () => null,
      get_desktop_installation_witness: () => 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      get_desktop_session_state: () => window.__TAURI_MOCK_DESKTOP_SESSION_STATE__ || ({
        available: true,
        screenLocked: false,
        error: null,
      }),
      get_background_runtime_active_operation: () => ({
        operation: null,
        ageMs: null,
      }),
      get_runtime_memory_stats: () => ({
        totalPhysicalMemoryBytes: 16 * 1024 * 1024 * 1024,
        processResidentBytes: 64 * 1024 * 1024,
        processFootprintBytes: 64 * 1024 * 1024,
        processVirtualBytes: 256 * 1024 * 1024,
        appResidentBytes: 160 * 1024 * 1024,
        appMemoryPressureBytes: 160 * 1024 * 1024,
        webkitResidentBytes: 96 * 1024 * 1024,
        webkitFootprintBytes: 96 * 1024 * 1024,
        webkitVirtualBytes: 512 * 1024 * 1024,
        webkitProcessId: 12345,
        webkitTotalResidentBytes: 96 * 1024 * 1024,
        webkitTotalFootprintBytes: 96 * 1024 * 1024,
        webkitProcessCount: 1,
        webkitLargestResidentBytes: 96 * 1024 * 1024,
        webkitLargestFootprintBytes: 96 * 1024 * 1024,
        webkitLargestProcessId: 12345,
        webkitLargestCpuUsage: 0,
        webkitLargestAgeSeconds: 10,
        webkitLargestRole: 'freed-webcontent',
        webkitProcesses: [{
          processId: 12345,
          residentBytes: 96 * 1024 * 1024,
          footprintBytes: 96 * 1024 * 1024,
          virtualBytes: 512 * 1024 * 1024,
          cpuUsage: 0,
          ageSeconds: 10,
          role: 'freed-webcontent',
        }],
        webkitTelemetryAvailable: true,
        webkitAttributionPrecise: true,
        indexedDbBytes: 8 * 1024 * 1024,
        webkitCacheBytes: 16 * 1024 * 1024,
        storageSizesSampled: true,
        sampleDurationMs: 1,
        memoryHighBytes: 2508 * 1024 * 1024,
        memoryCriticalBytes: 3584 * 1024 * 1024,
        relayDocBytes: 0,
        relayClientCount: 0,
      }),
      trim_webkit_network_cache_now: () => ({
        beforeBytes: 16 * 1024 * 1024,
        afterBytes: 16 * 1024 * 1024,
        cacheTrimmed: false,
      }),
      get_ai_hardware_profile: (args) => ({
        totalMemoryBytes: 16 * 1024 * 1024 * 1024,
        availableMemoryBytes: 10 * 1024 * 1024 * 1024,
        availableAppDataBytes: 64 * 1024 * 1024 * 1024,
        os: 'macos',
        arch: 'aarch64',
        webGPUAvailable: !!(args && args.webGpuAvailable),
      }),
      prepare_social_scrape_memory: () => {
        const after = {
          totalPhysicalMemoryBytes: 16 * 1024 * 1024 * 1024,
          processResidentBytes: 64 * 1024 * 1024,
          processVirtualBytes: 256 * 1024 * 1024,
          appResidentBytes: 160 * 1024 * 1024,
          webkitResidentBytes: 96 * 1024 * 1024,
          webkitVirtualBytes: 512 * 1024 * 1024,
          webkitProcessId: 12345,
          webkitTotalResidentBytes: 96 * 1024 * 1024,
          webkitProcessCount: 1,
          webkitLargestResidentBytes: 96 * 1024 * 1024,
          webkitLargestProcessId: 12345,
          webkitLargestCpuUsage: 0,
          webkitLargestAgeSeconds: 10,
          webkitLargestRole: 'freed-webcontent',
          webkitProcesses: [{
            processId: 12345,
            residentBytes: 96 * 1024 * 1024,
            virtualBytes: 512 * 1024 * 1024,
            cpuUsage: 0,
            ageSeconds: 10,
            role: 'freed-webcontent',
          }],
          webkitTelemetryAvailable: true,
          indexedDbBytes: 8 * 1024 * 1024,
          webkitCacheBytes: 16 * 1024 * 1024,
          memoryHighBytes: 2508 * 1024 * 1024,
          memoryCriticalBytes: 3584 * 1024 * 1024,
          relayDocBytes: 0,
          relayClientCount: 0,
        };
        return {
          before: after,
          after,
          recycledScraperWindows: false,
          cacheTrimmed: false,
          scraperRecycleVerification: null,
          mayProceed: true,
        };
      },
      get_updater_target: () => 'darwin-aarch64',
      retry_startup_after_crash: () => null,
      export_startup_diagnostics: () => '/Users/test/Downloads/freed-diagnostics-test.json',
      clear_factory_reset_runtime_artifacts: () => null,
      get_recent_logs: () => [],
      get_recent_runtime_health: () => [],
      show_window: () => null,
      list_snapshots: () => [],
      save_url_content: () => null,
      get_x_cookies: () => null,
      open_x_login_window: () => null,
      check_x_login_cookies: () => ({ status: 'closed' }),
      close_x_login_window: () => null,
      pick_contact: () => null,
      get_social_provider_cookie_state: (args) => ({
        provider: args && args.provider ? args.provider : 'facebook',
        ...(window.__TAURI_MOCK_SOCIAL_COOKIE_STATES__ &&
        args &&
        args.provider &&
        window.__TAURI_MOCK_SOCIAL_COOKIE_STATES__[args.provider]
          ? window.__TAURI_MOCK_SOCIAL_COOKIE_STATES__[args.provider]
          : {
              available: false,
              hasAuthCookie: false,
              cookieCount: 0,
              cookieNames: [],
              error: null,
            }),
      }),
      fb_show_login: () => null,
      fb_hide_login: () => null,
      fb_check_auth: () => true,
      fb_scrape_feed: () => null,
      fb_scrape_groups: () => [],
      fb_check_group_membership: (args) => ({
        id: args && args.groupId ? args.groupId : '',
        url: args && args.groupUrl ? args.groupUrl : '',
        name: null,
        stillJoined: null,
        reason: 'mock membership control not found',
        checkedAt: Date.now(),
      }),
      fb_scrape_comments: () => null,
      fb_disconnect: () => null,
      ig_show_login: () => null,
      ig_hide_login: () => null,
      ig_check_auth: () => true,
      ig_scrape_feed: () => null,
      ig_scrape_comments: () => null,
      ig_disconnect: () => null,
      li_show_login: () => null,
      li_hide_login: () => null,
      li_check_auth: () => true,
      li_scrape_feed: () => null,
      li_disconnect: () => null,
      substack_show_login: () => null,
      substack_hide_login: () => null,
      substack_check_auth: () => true,
      substack_disconnect: () => null,
      substack_scrape_graph: () => null,
      substack_scrape_activity: () => null,
      substack_scrape_essays: () => null,
      medium_show_login: () => null,
      medium_hide_login: () => null,
      medium_check_auth: () => true,
      medium_disconnect: () => null,
      medium_scrape_graph: () => null,
      medium_scrape_activity: () => null,
      medium_scrape_essays: () => null,
      yt_show_login: () => {
        window.__TAURI_MOCK_YOUTUBE_WINDOW_VISIBLE__ = true;
        return null;
      },
      yt_hide_login: () => {
        window.__TAURI_MOCK_YOUTUBE_WINDOW_VISIBLE__ = false;
        return null;
      },
      yt_check_auth: () => true,
      yt_capture: () => {
        window.__TAURI_MOCK_YOUTUBE_WINDOW_VISIBLE__ = false;
        return null;
      },
      yt_add_to_offline_playlist: () => {
        window.__TAURI_MOCK_YOUTUBE_WINDOW_VISIBLE__ = false;
        return null;
      },
      yt_disconnect: () => {
        window.__TAURI_MOCK_YOUTUBE_WINDOW_VISIBLE__ = false;
        return null;
      },
    };
    window.__TAURI_MOCK_INVOCATIONS__ = [];
    window.__TAURI_MOCK_OPENED_URLS__ = [];
    window.__TAURI_MOCK_WINDOW_DRAG_CALLS__ = [];
    window.__TAURI_MOCK_GLOBAL_SHORTCUTS__ = {};
    window.__TAURI_MOCK_GLOBAL_SHORTCUT_CALLS__ = [];
    window.__TAURI_MOCK_CALLBACKS__ = {};
    window.__TAURI_MOCK_PLUGIN_EVENT_LISTENERS__ = {};
    window.__TAURI_MOCK_UPDATE_CHECK_CALLS__ = [];

    var nextCallbackId = 1;
    var nextPluginEventId = 1;
    window.__TAURI_INTERNALS__ = window.__TAURI_INTERNALS__ || {};
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
      unregisterListener: function(event, eventId) {
        var record = window.__TAURI_MOCK_PLUGIN_EVENT_LISTENERS__[eventId];
        if (record && record.event === event) {
          delete window.__TAURI_MOCK_PLUGIN_EVENT_LISTENERS__[eventId];
        }
      }
    };
    window.__TAURI_INTERNALS__.invoke = function(cmd, args) {
      mockArray('__TAURI_MOCK_INVOCATIONS__').push({ cmd: cmd, args: args });
      if (cmd === 'plugin:event|listen') {
        var eventId = nextPluginEventId++;
        window.__TAURI_MOCK_PLUGIN_EVENT_LISTENERS__[eventId] = {
          event: String((args && args.event) || ''),
          callbackId: Number((args && args.handler) || 0)
        };
        return Promise.resolve(eventId);
      }
      if (cmd === 'plugin:event|unlisten') {
        delete window.__TAURI_MOCK_PLUGIN_EVENT_LISTENERS__[Number((args && args.eventId) || 0)];
        return Promise.resolve(null);
      }
      if (cmd === 'plugin:event|emit' || cmd === 'plugin:event|emit_to') {
        var eventName = String((args && args.event) || '');
        var payload = args && args.payload;
        Object.keys(window.__TAURI_MOCK_PLUGIN_EVENT_LISTENERS__).forEach(function(id) {
          var record = window.__TAURI_MOCK_PLUGIN_EVENT_LISTENERS__[id];
          if (!record || record.event !== eventName) return;
          var callback = window.__TAURI_MOCK_CALLBACKS__[record.callbackId];
          if (typeof callback === 'function') {
            callback({
              event: eventName,
              id: Number(id),
              payload: payload,
              windowLabel: 'main'
            });
          }
        });
        return Promise.resolve(null);
      }
      var handler = window.__TAURI_MOCK_HANDLERS__[cmd];
      return Promise.resolve(handler ? handler(args || {}) : null);
    };
    window.__TAURI_INTERNALS__.transformCallback = function(callback) {
      var id = nextCallbackId++;
      window.__TAURI_MOCK_CALLBACKS__[id] = callback;
      return id;
    };
    window.__TAURI_INTERNALS__.unregisterCallback = function(id) {
      delete window.__TAURI_MOCK_CALLBACKS__[id];
    };
    window.__TAURI_INTERNALS__.callbacks = window.__TAURI_MOCK_CALLBACKS__;
    window.__TAURI_INTERNALS__.metadata = window.__TAURI_INTERNALS__.metadata || {
      currentWindow: { label: 'main' },
      currentWebview: { label: 'main' }
    };
    window.__TAURI_INTERNALS__.convertFileSrc =
      window.__TAURI_INTERNALS__.convertFileSrc || function(filePath) { return filePath; };
    window.__TAURI_INTERNALS__.plugins = window.__TAURI_INTERNALS__.plugins || {
      path: { sep: '/', delimiter: ':' }
    };
  })();`;
}
