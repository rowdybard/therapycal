# Firebase Setup Instructions for Google Sign-In

## Current Issue
Google Sign-In is failing with "auth/unauthorized-domain" error because the current domain is not authorized in Firebase.

## How to Fix

### 1. Enable Google Provider
1. Go to [Firebase Console](https://console.firebase.google.com)
2. Select your project: `therapy-calendar-73429`
3. Navigate to **Authentication** → **Sign-in method**
4. Click on **Google** provider
5. Click **Enable** toggle
6. Save the configuration

### 2. Add Authorized Domains
1. In Firebase Console, go to **Authentication** → **Settings** → **Authorized domains**
2. Click **Add domain**
3. **Add these specific domains:**
   - For this Replit app: Add the exact domain shown in your browser address bar
   - Common Replit patterns: `*.replit.app` or `*.replit.dev`
   - If using custom domain: add your specific domain

### 3. Current Domain Issue
The error message will show the exact domain that needs to be authorized.
**Copy the domain from the error message and add it to Firebase authorized domains.**

### 4. Alternative: Disable Google Sign-In Temporarily
If domain setup is complex, you can:
1. Use email/password authentication (fully working)
2. Set up Google Sign-In later when deploying to production

### 4. Test Google Sign-In
After adding the domain, Google Sign-In should work properly.

## Alternative Solution
If Google Sign-In continues to have issues, users can still sign in with email/password which works perfectly.

## Current Status
- ✅ Email/Password authentication working
- ⚠️ Google Sign-In needs domain authorization
- ✅ All calendar features working after authentication