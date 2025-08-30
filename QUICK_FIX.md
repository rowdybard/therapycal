# Quick Fix for Google Sign-In

The Google Sign-In is failing because your current domain needs to be authorized in Firebase.

## Immediate Solution

### Option 1: Use Email/Password (Currently Working)
- Click "Don't have an account? Sign up" 
- Create account with email/password
- This works perfectly and gives full access to the therapy calendar

### Option 2: Fix Google Sign-In
1. Go to Firebase Console: https://console.firebase.google.com
2. Select your project: `therapy-calendar-73429`
3. Go to **Authentication** → **Settings** → **Authorized domains**
4. Click **Add domain**
5. Add your current domain (the error message will show it exactly)
6. Save changes

## Current Status
- ✅ Email/Password authentication: **WORKING**
- ❌ Google Sign-In: Needs domain authorization
- ✅ All calendar features: **WORKING** after login

## Recommendation
For immediate access, use email/password authentication. You can set up Google Sign-In later.