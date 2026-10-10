# PWA Optimization Deployment Checklist

**Date:** 2026-03-18  
**Version:** 1.0  

---

## Pre-Deployment (Local Development)

### Build Verification
- [ ] `npm install` completes without errors
- [ ] `npm run build` succeeds
- [ ] `dist/service-worker.js` is generated (~30KB)
- [ ] `dist/manifest.json` exists and is valid
- [ ] No TypeScript/ESLint errors
- [ ] No console warnings during build

### File Verification
```bash
# Check these files were updated:
✅ vite.config.js (NEW)
✅ vite.config.augment.js (UPDATED)
✅ public/service-worker.js (UPDATED)
✅ public/manifest.json (NEW)
✅ pages/NewReceipt (lazy-loading added)
✅ pages/ReceiptDetail (lazy-loading added)
```

### Local Testing
- [ ] `npm run preview` starts server
- [ ] App loads in browser (<2s)
- [ ] No JavaScript errors in console
- [ ] All pages accessible
- [ ] Images render correctly

---

## DevTools Verification (Before Deploy)

### Service Worker
```
Chrome DevTools → Application → Service Workers
- [ ] Service worker: "running"
- [ ] Scope: "/"
- [ ] Updates: "every hour" (shown)
```

### Cache Storage
```
Chrome DevTools → Application → Cache Storage
- [ ] workbox-precache-v2: ~1MB
- [ ] (other caches empty - populated on use)

Total precache: <1.5MB ✅
```

### Manifest
```
Chrome DevTools → Application → Manifest
- [ ] name: "BillTap - Split Bills Instantly"
- [ ] short_name: "BillTap"
- [ ] display: "standalone"
- [ ] theme_color: "#4338ca"
- [ ] start_url: "/"
```

### Network Tab
```
Chrome DevTools → Network
- [ ] Initial load: <2 seconds
- [ ] Core bundles precached: ✓
- [ ] Images NOT in precache
- [ ] favicon.svg loaded
```

### Memory
```
Chrome DevTools → Memory
- [ ] Heap size initial: <20MB
- [ ] After image load: <25MB
- [ ] No memory leaks after navigation
```

---

## Staging Deployment

### Pre-Staging
- [ ] Tested all local checks above
- [ ] Ready to commit changes
- [ ] Review diff: All files as expected

### Deploy to Staging
```bash
# Staging deployment steps:
1. [ ] `npm run build`
2. [ ] Copy `dist/` to staging server
3. [ ] Test staging domain loads
4. [ ] Verify service worker is running
5. [ ] Check DevTools cache storage
```

### Staging Testing (48 hours)
- [ ] No crash reports
- [ ] Performance metrics stable
- [ ] Users can update app
- [ ] Offline functionality works
- [ ] No cache corruption

---

## Staging Verification

### Performance Metrics
```
Lighthouse Score:
- [ ] Performance: >90
- [ ] Accessibility: >90
- [ ] Best Practices: >90
- [ ] PWA: >90
- [ ] SEO: >90
```

### Cache Testing
```
Chrome DevTools → Cache Storage
- [ ] Precache: exactly 1.04MB
- [ ] No unexpected files cached
- [ ] Image cache empty initially
- [ ] API cache empty initially
```

### Offline Mode Testing
```
Chrome DevTools → Network → Offline
- [ ] App shell loads from cache
- [ ] Images previously viewed load
- [ ] New image requests fail gracefully
- [ ] API calls show offline error
- [ ] UI remains usable
```

### Cross-Browser Testing (Staging)
- [ ] Chrome latest ✅
- [ ] Firefox latest ✅
- [ ] Safari latest ✅
- [ ] Edge latest ✅
- [ ] Mobile Chrome ✅

---

## Production Deployment

### Final Checks Before Deploy
- [ ] All staging tests pass
- [ ] No critical issues found
- [ ] Product manager approval
- [ ] Rollback plan reviewed

### Production Deployment Steps
```bash
1. [ ] `npm run build` (final build)
2. [ ] Copy `dist/` to production server
3. [ ] Verify CDN configuration
4. [ ] Service worker endpoint accessible
5. [ ] HTTPS enabled (required for SW)
6. [ ] Proper caching headers set
```

### Production Verification (Immediate)
- [ ] Production domain loads
- [ ] Service worker registers
- [ ] DevTools shows precache
- [ ] No error logs in monitoring
- [ ] Performance baseline met

### Production Monitoring (24 hours)
- [ ] Crash rate: 0 (or baseline)
- [ ] Performance: Maintained or improved
- [ ] User issues: None reported
- [ ] Cache metrics: Normal
- [ ] Service worker updates: Working

### Production Metrics (1 week)
```
Target Metrics:
- [ ] Initial memory: <20MB ✅
- [ ] Load time: <2s ✅
- [ ] Cache hit rate: >80% ✅
- [ ] Crash rate: <0.1% ✅
- [ ] User satisfaction: Stable ✅
```

---

## Post-Deployment (Ongoing)

### Daily (First Week)
- [ ] Monitor crash reports
- [ ] Check error logs
- [ ] Verify SW registration rate
- [ ] Monitor network errors

### Weekly
- [ ] Cache hit rate analysis
- [ ] Performance metrics review
- [ ] User feedback
- [ ] Any issues reported?

### Monthly
- [ ] Full Lighthouse audit
- [ ] Cache size trends
- [ ] Performance benchmarks
- [ ] Update documentation

---

## Rollback Procedure (If Needed)

### Option 1: Quick Rollback (Service Worker Only)
```bash
1. [ ] Deploy previous service-worker.js
2. [ ] Clear old caches: DevTools → Clear site data
3. [ ] Users will get new SW on next visit
4. [ ] Precache reverts to previous version
```

### Option 2: Full Rollback
```bash
1. [ ] Revert deployment to previous version
2. [ ] Wait 1 hour for SW to update
3. [ ] Monitor metrics return to normal
4. [ ] Post-mortem analysis
```

### Recovery Checklist
- [ ] All metrics restored to baseline
- [ ] No outstanding user issues
- [ ] Error logs cleared
- [ ] Root cause identified
- [ ] Fix implemented
- [ ] Re-deploy approved

---

## Sign-Off

### Development Team
- [ ] Code reviewed
- [ ] Tests passed
- [ ] Deployment tested locally
- [ ] Ready for staging

### QA/Testing Team
- [ ] Staging tests passed
- [ ] Performance verified
- [ ] Offline mode tested
- [ ] Cross-browser verified

### Product/DevOps
- [ ] Approval to deploy
- [ ] Monitoring configured
- [ ] Rollback plan ready
- [ ] Post-deploy plan scheduled

---

## Emergency Contacts

If issues occur post-deployment:

| Role | Escalation |
|------|-----------|
| Performance issues | Tech Lead |
| Service Worker problems | Lead Dev |
| User-facing bugs | Product Manager |
| Infrastructure issues | DevOps |

---

## Deployment Summary

**Deployment Date:** _________________  
**Deployed By:** _________________  
**Reviewed By:** _________________  
**Production Time:** _________________  
**Status:** ☐ Successful ☐ Rollback

### Notes
_________________________________________________________________________

_________________________________________________________________________

_________________________________________________________________________

---

## Quick Reference

### Key URLs
- Production: https://billtap.app
- Staging: https://staging.billtap.app
- Service Worker: https://billtap.app/service-worker.js
- Manifest: https://billtap.app/manifest.json

### Key Metrics Baseline
- Initial load: <2s
- Memory: <20MB
- Cache hit: >80%
- Lighthouse: >90

### Quick Tests
```bash
# Test precache size
# DevTools → Cache Storage → workbox-precache-v2
# Size should be ~1MB

# Test image lazy-loading
# Navigate to page with image
# Network tab should show image loads on demand

# Test offline
# DevTools → Network → Offline
# App should load core shell from cache
```

---

**Checklist Version:** 1.0  
**Last Updated:** 2026-03-18  
**Maintainer:** Development Team

Print this checklist and check off items as you go through deployment.