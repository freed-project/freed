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
    function sqliteShellResult() {
      var state = sqliteState();
      var items = Object.values(state.items).filter(function(item) { return !item.__deleted; });
      var countsByPlatform = {};
      var unreadByPlatform = {};
      items.forEach(function(item) {
        countsByPlatform[item.platform] = (countsByPlatform[item.platform] || 0) + 1;
        if (sqliteItemState(item).readAt == null) {
          unreadByPlatform[item.platform] = (unreadByPlatform[item.platform] || 0) + 1;
        }
      });
      return {
        shellJson: JSON.stringify(state.shell || {}),
        revision: state.revision,
        itemCount: items.length,
        unreadCount: items.filter(function(item) { return sqliteItemState(item).readAt == null; }).length,
        archivableCount: items.filter(function(item) {
          var user = sqliteItemState(item);
          return user.readAt != null && !user.saved && !user.archived && !user.hidden;
        }).length,
        countsByPlatform: countsByPlatform,
        unreadByPlatform: unreadByPlatform,
      };
    }
    function sqliteCountsResult() {
      var shell = sqliteShellResult();
      var archivableByPlatform = {};
      var feedCounts = {};
      var unreadFeedCounts = {};
      var archivableFeedCounts = {};
      Object.values(sqliteState().items).filter(function(item) { return !item.__deleted; }).forEach(function(item) {
        var user = sqliteItemState(item);
        var platform = item.platform || 'unknown';
        var archivable = user.readAt != null && !user.saved;
        if (archivable) archivableByPlatform[platform] = (archivableByPlatform[platform] || 0) + 1;
        var feedUrl = item.rssSource && item.rssSource.feedUrl;
        if (!feedUrl) return;
        feedCounts[feedUrl] = (feedCounts[feedUrl] || 0) + 1;
        if (user.readAt == null) unreadFeedCounts[feedUrl] = (unreadFeedCounts[feedUrl] || 0) + 1;
        if (archivable) archivableFeedCounts[feedUrl] = (archivableFeedCounts[feedUrl] || 0) + 1;
      });
      return {
        revision: shell.revision,
        itemCount: shell.itemCount,
        unreadCount: shell.unreadCount,
        archivableCount: shell.archivableCount,
        countsByPlatform: shell.countsByPlatform,
        unreadByPlatform: shell.unreadByPlatform,
        archivableByPlatform: archivableByPlatform,
        feedCounts: feedCounts,
        unreadFeedCounts: unreadFeedCounts,
        archivableFeedCounts: archivableFeedCounts,
      };
    }
    function sqliteSyncDescriptor() {
      var state = sqliteState();
      var items = Object.values(state.items).filter(function(item) { return !item.__deleted; });
      return {
        revision: state.revision,
        itemCount: items.length,
        sourceDigest: state.sourceDigest || '0'.repeat(64),
        shellJson: JSON.stringify(state.shell || {}),
        materializedDigest: '1'.repeat(64),
      };
    }
    function sqliteAuthorityBootstrap() {
      return {
        authority: {
          library_id: '2'.repeat(64),
          epoch: 1,
          epoch_id: '3'.repeat(64),
          authority_key_id: '4'.repeat(64),
          authority_public_key: '5'.repeat(64),
          observed_frontier: [],
        },
        actor: {
          actor_id: '6'.repeat(64),
          actor_public_key: '7'.repeat(64),
          enrollment_operation_id: 'e2e-local-authority-enrollment',
          enrollment_certificate_digest: '8'.repeat(64),
          canonical_enrollment_certificate_json: '{}',
          actor_chain_genesis: '9'.repeat(64),
        },
        protocol: {
          format: 'freed_library_core_native_authority_protocol_v1',
          active_engine: 'library_core_v1',
          schema_version: 12,
          replication_protocol: 'op_segments_v1',
          checkpoint_format: 'freed_logical_checkpoint_v1',
          transition_certificate_digest: 'a'.repeat(64),
          native_protocol_certificate_digest: 'b'.repeat(64),
          prior_transition_certificate_digest: null,
          source_manifest_digest: 'c'.repeat(64),
        },
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
    function sqliteUpsertItems(args) {
      var state = sqliteState();
      var request = args && args.request ? args.request : {};
      (request.itemsBase64 || []).forEach(function(encoded) {
        var binary = atob(encoded);
        var bytes = Uint8Array.from(binary, function(character) {
          return character.charCodeAt(0);
        });
        var item = JSON.parse(new TextDecoder().decode(bytes));
        state.items[item.globalId] = item;
      });
      state.revision += 1;
      persistSqliteState();
      return null;
    }
    function sqliteAppendImportItems(args) {
      var stage = window.__TAURI_MOCK_SQLITE_IMPORT_STAGE__;
      if (!stage) throw new Error('SQLite Library has no active staged import');
      var request = args && args.request ? args.request : {};
      (request.itemsBase64 || []).forEach(function(encoded) {
        var binary = atob(encoded);
        var bytes = Uint8Array.from(binary, function(character) {
          return character.charCodeAt(0);
        });
        var item = JSON.parse(new TextDecoder().decode(bytes));
        stage.items[item.globalId] = item;
      });
      return null;
    }
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
    window.__TAURI_MOCK_HANDLERS__ = {
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
      begin_sqlite_library_import: (args) => {
        var request = args.request;
        window.__TAURI_MOCK_SQLITE_IMPORT_STAGE__ = {
          sourceGeneration: request.sourceGeneration,
          sourceRevision: request.sourceRevision,
          sourceDigest: request.sourceDigest,
          expectedItemCount: request.expectedItemCount,
          shell: JSON.parse(request.shellJson),
          items: {},
        };
        return null;
      },
      append_sqlite_library_import: sqliteAppendImportItems,
      finalize_sqlite_library_import: () => {
        var stage = window.__TAURI_MOCK_SQLITE_IMPORT_STAGE__;
        if (!stage) throw new Error('SQLite Library has no complete staged import');
        if (Object.keys(stage.items).length !== stage.expectedItemCount) {
          throw new Error('SQLite Library import count mismatch');
        }
        var state = sqliteState();
        Object.assign(state, stage, { active: true, revision: 1 });
        delete window.__TAURI_MOCK_SQLITE_IMPORT_STAGE__;
        persistSqliteState();
        return {
          active: true,
          revision: state.revision,
          expectedItemCount: state.expectedItemCount,
          importedItemCount: Object.keys(state.items).length,
          sourceGeneration: state.sourceGeneration,
          sourceRevision: state.sourceRevision,
          sourceDigest: state.sourceDigest,
        };
      },
      recover_sqlite_library_follower_overlay: () => ({
        transactionCount: 0,
        operationCount: 0,
        materializedRowCount: 0,
        revisionAdvanced: false,
      }),
      read_sqlite_library_sync_descriptor: sqliteSyncDescriptor,
      bootstrap_sqlite_library_authority: sqliteAuthorityBootstrap,
      read_sqlite_library_shell: () => {
        // Scale benchmarks keep the corpus in mock SQLite while forcing the
        // shell projection to match production's empty renderer item array.
        // Direct bounded scans still read the complete mock corpus below.
        if (window.__FREED_E2E_SQLITE_SHELL_ONLY__ === true) {
          window.__FREED_E2E_SQLITE_SHELL_QUERY_PENDING__ = true;
        }
        return sqliteShellResult();
      },
      read_sqlite_library_counts: sqliteCountsResult,
      read_sqlite_library_facet_summary: sqliteFacetSummary,
      replace_sqlite_library_shell: (args) => {
        sqliteState().shell = JSON.parse(args.request.shellJson);
        sqliteState().revision += 1;
        persistSqliteState();
        return null;
      },
      upsert_sqlite_library_items: sqliteUpsertItems,
      mutate_sqlite_library_items: sqliteMutateItems,
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
      sqlite_library_follower_intent_context: () => null,
      sqlite_library_follower_runtime_status: () => ({
        state: 'awaiting_checkpoint',
        libraryId: null,
        epochId: null,
        actorId: null,
        checkpointGeneration: null,
        remoteIngestSequence: null,
        pendingIntentCount: 0,
        publishedIntentCount: 0,
        importedResultCount: 0,
      }),
      read_sqlite_library_follower_intent_outbox_candidate: () => null,
      record_sqlite_library_follower_intent_publication: (args) => {
        var request = args.request || {};
        return {
          firstIntentSequence: request.firstIntentSequence,
          lastIntentSequence: request.lastIntentSequence,
          operationCount: request.lastIntentSequence - request.firstIntentSequence + 1,
          publishedSegmentDigest: request.publishedSegmentDigest,
          status: 'recorded',
        };
      },
      read_sqlite_library_follower_result_import_cursor: () => null,
      append_sqlite_library_follower_result_segment: (args) => {
        var request = args.request || {};
        return {
          firstResultSequence: request.firstResultSequence,
          lastResultSequence: request.lastResultSequence,
          resultCount: (request.entries || []).length,
          segmentDigest: request.segmentDigest,
          status: 'imported',
        };
      },
      read_sqlite_library_items: (args) => (args.request.ids || []).map(function(id) {
        var item = sqliteState().items[id];
        return item && !item.__deleted ? JSON.stringify(item) : null;
      }).filter(Boolean),
      query_sqlite_library_items: (args) => {
        if (window.__FREED_E2E_SQLITE_SHELL_QUERY_PENDING__ === true) {
          window.__FREED_E2E_SQLITE_SHELL_QUERY_PENDING__ = false;
          return {
            itemsJson: [],
            nextOffset: null,
            totalCount: 0,
          };
        }
        var request = args.request || {};
        var query = (request.query || '').toLowerCase();
        var items = Object.values(sqliteState().items).filter(function(item) {
          var user = sqliteItemState(item);
          var authorKeys = request.authorKeys || [];
          var itemSignals = item.contentSignals && item.contentSignals.tags || [];
          return !item.__deleted
            && (!request.platform || item.platform === request.platform)
            && (!request.contentType || item.contentType === request.contentType)
            && (!request.excludeContentType || item.contentType !== request.excludeContentType)
            && (request.saved == null || !!user.saved === request.saved)
            && (request.archived == null || !!user.archived === request.archived)
            && (request.showHidden || !user.hidden)
            && (!request.authorId || (item.author && item.author.id === request.authorId))
            && (!request.feedUrl || (item.rssSource && item.rssSource.feedUrl === request.feedUrl))
            && (!authorKeys.length || authorKeys.some(function(key) {
              return key.platform === item.platform && key.authorId === (item.author && item.author.id);
            }))
            && (!request.tags || !request.tags.length || request.tags.some(function(tag) {
              return (user.tags || []).includes(tag);
            }))
            && (!request.signals || !request.signals.length || request.signals.some(function(signal) {
              return itemSignals.includes(signal);
            }))
            && (!query || JSON.stringify(item).toLowerCase().includes(query));
        }).sort(function(left, right) {
          return (right.publishedAt || 0) - (left.publishedAt || 0)
            || (right.capturedAt || 0) - (left.capturedAt || 0)
            || String(left.globalId).localeCompare(String(right.globalId));
        });
        var offset = request.offset || 0;
        var limit = Math.max(1, Math.min(request.limit || 64, 128));
        var page = items.slice(offset, offset + limit);
        return {
          itemsJson: page.map(JSON.stringify),
          nextOffset: offset + page.length < items.length ? offset + page.length : null,
          totalCount: items.length,
        };
      },
      search_sqlite_library_items: (args) => {
        var request = args.request || {};
        var state = sqliteState();
        if (request.expectedRevision !== state.revision) {
          throw new Error('SQLite Library changed during its bounded search');
        }
        var candidates = Object.values(state.items)
          .filter(function(item) {
            return !item.__deleted
              && (!request.afterGlobalId || String(item.globalId) > request.afterGlobalId);
          })
          .sort(function(left, right) {
            return String(left.globalId).localeCompare(String(right.globalId));
          });
        var query = String(request.query || '').toLowerCase();
        var limit = Math.max(1, Math.min(request.limit || 32, 32));
        var scanned = 0;
        var matches = [];
        var lastScanned = null;
        while (scanned < candidates.length && scanned < 256 && matches.length < limit) {
          var item = candidates[scanned];
          lastScanned = String(item.globalId);
          if (JSON.stringify(item).toLowerCase().includes(query)) {
            matches.push({ itemJson: JSON.stringify(item), score: 1 });
          }
          scanned += 1;
        }
        return {
          matches: matches,
          nextAfterGlobalId: scanned < candidates.length ? lastScanned : null,
          sourceRevision: state.revision,
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
