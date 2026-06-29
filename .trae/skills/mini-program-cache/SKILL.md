---
name: "mini-program-cache"
description: "Manages WeChat Mini Program cache, global listeners, and page lifecycle coordination. Invoke when debugging real-time data updates, white screen issues, or cache synchronization problems."
---

# WeChat Mini Program Cache & Listener Coordination

This skill documents the coordination mechanism between global listeners, local cache, and page lifecycle in WeChat Mini Programs, focusing on the homepage data synchronization flow.

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        App Layer                                │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │              GlobalProductWatcher                           ││
│  │  - Real-time database listener (onSnapshot)                 ││
│  │  - Cache management (_cacheUpdated Map)                     ││
│  │  - Version tracking (updateVersion)                         ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                       Storage Layer                             │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                  wx.setStorageSync('homeData')              ││
│  │  - seriesList: Array<Series>                                ││
│  │  - newProducts: Array<Product>                              ││
│  │  - bannerList: Array<Banner>                                ││
│  │  - updateVersion: number (incrementing)                     ││
│  │  - cacheStatus: 'healthy' | 'warning' | 'corrupted'         ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                        Page Layer                               │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                     Home Page                                ││
│  │  - onLoad: Initialize, load from cache                       ││
│  │  - onShow: Quick display + async check                       ││
│  │  - onHide: Cleanup                                          ││
│  │  - _asyncCheckAndUpdate: Background update logic            ││
│  │  - _lastUpdateVersion: Track last displayed version         ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

## Key Components

### 1. GlobalProductWatcher

**Location**: [miniprogram/utils/globalProductWatcher.js](file:///Users/xiexiaoqiong/WeChatProjects/tta/miniprogram/utils/globalProductWatcher.js)

**Responsibilities**:
- Subscribe to real-time database changes (onSnapshot)
- Update local cache when data changes
- Track cache status (healthy/warning/corrupted)
- Manage update markers (_cacheUpdated Map)

**Key Methods**:
- `checkNeedsRefresh()`: Check listener health status
- `getAndClearUpdateMark(cacheKey)`: Get and clear update marker
- `_updateHomeCache(changeType, docId, product)`: Update home page cache
- `_markCacheUpdated(cacheKey)`: Mark cache as updated

### 2. Home Page Cache

**Location**: `wx.setStorageSync('homeData')`

**Structure**:
```javascript
{
  seriesList: Array,      // Product series data
  newProducts: Array,     // New products data
  bannerList: Array,      // Banner data
  updateVersion: number,  // Incrementing version number
  cacheStatus: string,    // 'healthy' | 'warning' | 'corrupted'
  lastUpdateTime: number  // Timestamp of last update
}
```

### 3. Home Page Lifecycle

**Location**: [miniprogram/pages/home/index.js](file:///Users/xiexiaoqiong/WeChatProjects/tta/miniprogram/pages/home/index.js)

**onLoad**:
- Initialize page data
- Load from cache if available
- Set `_isFirstEntry = true`

**onShow**:
- If `seriesList.length > 0`: Quick display (no white screen)
- If empty: Load from cache (`_quickShowFromCache`)
- Always call `_asyncCheckAndUpdate()` for background sync

**onHide**:
- Cleanup resources

## Data Flow

### First Entry Flow

```
onLoad → _quickShowFromCache → setData (show cache)
                                ↓
onShow → _asyncCheckAndUpdate → checkNeedsRefresh()
                                ↓
                          checkAndRefreshIfNeeded() → loadProducts()
                                ↓
                          Update cache + setData
```

### Return from Other Page Flow

```
onShow → Quick display (show existing data)
          ↓
        _asyncCheckAndUpdate → checkNeedsRefresh()
                                ↓
                          getAndClearUpdateMark('home_products')
                                ↓
                          check updateVersion → if updated, setData
                                ↓
                          Skip server version comparison (has data)
```

### Real-time Update Flow (On Other Page)

```
Database change → GlobalProductWatcher.onSnapshot
                    ↓
                  _updateHomeCache() → update homeData
                    ↓
                  _markCacheUpdated('home_products')
                    ↓
                  updateVersion++
                    ↓
                  wx.setStorageSync('homeData', updatedData)
```

## _asyncCheckAndUpdate Steps

The core async check method runs in these steps:

**Step 1: Listener Health Check**
- Call `watcher.checkNeedsRefresh()`
- If needs refresh: Call `loadProducts()` → Return

**Step 2: Update Marker Check**
- Call `watcher.getAndClearUpdateMark('home_products')`
- If marker exists: Call `loadProducts()` → Return

**Step 3: Banner/Category Refresh Check**
- Check `app.globalData.bannerNeedRefresh`
- Check `app.globalData.categoryNeedRefresh`
- Refresh individually if needed

**Step 4: Cache Status Check**
- If `cacheStatus === 'corrupted'`: Call `loadProducts()` → Return
- If `cacheStatus === 'warning'`: Call `checkAndRefreshIfNeeded()` → Restore to 'healthy' → Return

**Step 5: updateVersion Check**
- Compare `cacheVersion` vs `currentVersion`
- If `cacheVersion > currentVersion`: Update UI → Return
- If `cacheVersion <= currentVersion`: Continue

**Step 6: Server Version Comparison (Conditional)**
- **First entry OR page empty**: Call `checkAndRefreshIfNeeded()`
- **Return from other page with data**: Skip (global listener already handled)

## Common Scenarios

### Scenario 1: Product Stock Change (0 → 10)

**When on homepage**:
1. GlobalProductWatcher detects change
2. Updates `homeData.seriesList` and `homeData.newProducts`
3. Increments `updateVersion`
4. Sets update marker
5. Triggers page update via subscription

**When returning from other page**:
1. onShow displays existing data
2. _asyncCheckAndUpdate detects `updateVersion` change
3. Updates UI with new data

### Scenario 2: Product isNew Change (false → true)

**When on homepage**:
1. GlobalProductWatcher detects change
2. Adds to `newProducts` (unshift)
3. Updates `seriesList` with new status
4. Increments `updateVersion`

**When returning from other page**:
1. onShow displays existing data
2. _asyncCheckAndUpdate detects update
3. Updates UI

### Scenario 3: Product Offline (status → 'off')

**When on homepage**:
1. GlobalProductWatcher detects change
2. Removes from `newProducts`
3. Removes from `seriesList` and fills gap
4. Increments `updateVersion`

**When returning from other page**:
1. onShow displays existing data
2. _asyncCheckAndUpdate detects update
3. Updates UI

### Scenario 4: Network Exception

**When listener disconnected**:
1. `_handleError()` is called
2. `_reconnectAttempts` increments
3. `_scheduleReconnect()` schedules reconnection
4. `checkNeedsRefresh()` returns `needsRefresh: true`

**When returning to homepage with disconnected listener**:
1. onShow displays existing data
2. _asyncCheckAndUpdate step 1 detects `needsRefresh: true`
3. Calls `loadProducts()` → reloads from server
4. Listener reconnects automatically

**When reconnect succeeds**:
1. `_reconnectAttempts` resets to 0
2. `_isActive` becomes true
3. Subsequent updates work normally

### Scenario 5: App Background/Foreground Transition

**When app goes to background**:
1. App.onHide() is called
2. `lastLeaveTime` is saved to storage

**When app returns to foreground**:
1. App.onShow() is called
2. Calculates time elapsed since last leave
3. If time elapsed > threshold, may trigger refresh
4. Page.onShow() is called → normal flow

### Scenario 6: Cache Expiration

**When cache is fresh (within TTL)**:
1. `loadProducts()` shows cache immediately
2. Background check confirms cache is valid
3. No server request needed

**When cache is stale (beyond TTL)**:
1. First entry: `checkAndRefreshIfNeeded()` detects version mismatch
2. Calls `loadProducts()` → reloads from server
3. Updates cache with new data

**TTL Settings**:
- Memory cache: 30 minutes
- Storage cache: 24 hours

### Scenario 7: Product Category Change

**When product's categoryId changes**:
1. GlobalProductWatcher detects change
2. Updates `newProducts` if applicable
3. **⚠️ Current limitation**: Does not remove from old series
4. Adds to new series if not exists
5. Increments `updateVersion`

**Note**: This is a known limitation. When categoryId changes, the product may appear in both old and new series until full reload.

## Performance Optimization Rules

### Rule 1: Always Show First, Update Later
- Never block UI with network requests
- Show cached data immediately
- Update silently in background

### Rule 2: Avoid Redundant Server Calls
- First entry: Need server version check
- Return from page: Skip server check (global listener handles)

### Rule 3: Batch Updates
- Combine multiple updates into single setData
- Use updateVersion to track completeness

### Rule 4: Cache Status Management
- healthy: Normal operation
- warning: Potential inconsistency, needs verification
- corrupted: Data invalid, needs full reload

## Debug Checklist

### White Screen Issue
- [ ] Is `onShow` displaying cached data immediately?
- [ ] Is `_asyncCheckAndUpdate` blocking the main thread?
- [ ] Is `loadProducts()` showing cache first before server request?

### Real-time Update Issue
- [ ] Is GlobalProductWatcher subscribed to database?
- [ ] Is `updateVersion` incrementing on changes?
- [ ] Is `_cacheUpdated` Map being set correctly?
- [ ] Is homepage subscribed to watcher updates?

### Cache Inconsistency
- [ ] Is cache being written after updates?
- [ ] Is `updateVersion` being compared correctly?
- [ ] Is cacheStatus being managed properly?

## Common Pitfalls

### Pitfall 1: Forgetting to Update Both Arrays
When modifying a product, update both `seriesList` and `newProducts` if the product exists in both.

### Pitfall 2: Blocking setData with Async Operations
Never await async operations before setData - always show first, update later.

### Pitfall 3: Incorrect wasOffline Calculation
When checking if a product was offline, handle the case where the product is not in `newProducts` array.

### Pitfall 4: Redundant Server Version Checks
On page return, skip server version check if global listener already handled updates.

## Best Practices

### Use updateVersion for Precise Comparison
Instead of boolean flags, use incrementing version numbers for precise change detection.

### Centralize Cache Updates
Handle all cache updates in GlobalProductWatcher to ensure consistency.

### Separate UI Update from Data Load
Load data in background, update UI only when necessary.

### Log Everything
Add detailed console logs at each step for debugging.

## Code References

| Component | File | Key Lines |
|-----------|------|-----------|
| GlobalProductWatcher | [globalProductWatcher.js](file:///Users/xiexiaoqiong/WeChatProjects/tta/miniprogram/utils/globalProductWatcher.js) | 1-100 |
| Home Page onShow | [home/index.js](file:///Users/xiexiaoqiong/WeChatProjects/tta/miniprogram/pages/home/index.js) | 239-266 |
| _asyncCheckAndUpdate | [home/index.js](file:///Users/xiexiaoqiong/WeChatProjects/tta/miniprogram/pages/home/index.js) | 299-440 |
| loadProducts | [home/index.js](file:///Users/xiexiaoqiong/WeChatProjects/tta/miniprogram/pages/home/index.js) | 878-927 |
| _updateHomeCache | [globalProductWatcher.js](file:///Users/xiexiaoqiong/WeChatProjects/tta/miniprogram/utils/globalProductWatcher.js) | 751-865 |
