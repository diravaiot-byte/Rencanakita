# Firebase Authentication Setup

SharedWish uses Firebase Authentication's email/password provider. The UI asks for a username and password; usernames are mapped to an internal address ending in `@sharedwish.invalid`. No email address is requested or used for sign-in.

1. Create a Firebase project and add a Web app.
2. In Authentication > Sign-in method, enable Email/Password.
3. Copy the Web API key into `firebase-config.js`, replacing `REPLACE_WITH_FIREBASE_WEB_API_KEY`.
4. Deploy the Apps Script Web App and replace `REPLACE_WITH_APPS_SCRIPT_WEB_APP_URL` in `firebase-config.js` with its URL.
5. In the Apps Script project, open Project Settings > Script Properties and add `firebase_api_key` with the same Web API key.
6. Add the `appsscript.json` manifest from this project to the Apps Script project. If needed, enable **Show `appsscript.json` manifest file in editor** under Project Settings. Save the manifest so the external-request, script-storage, and spreadsheet OAuth scopes are included.
7. In the Apps Script editor, select `authorizeFirebaseAccess` and click Run. Review and approve the Google authorization prompt. The helper sends a deliberately invalid test token; it does not sign in or change account data.
8. Open **Deploy > Manage deployments**, edit the Web App deployment, set **Execute as** to **Me**, and create a **New version**. Allow the intended users to access it; use **Anyone** only if that is permitted by your Google account's policy.
9. Open `index.html`, register a username and password, then create or join a room using its Room ID and PIN.

If the same permission error remains, verify the script's **Overview > Project OAuth Scopes** includes `https://www.googleapis.com/auth/script.external_request`, confirm `authorizeFirebaseAccess` completed successfully in the same Apps Script project, and confirm the active deployment is a new version that executes as **Me**. Do not reuse an older deployment version.

The API key is a public Firebase client identifier, not a password. Firebase verifies and stores passwords; SharedWish never stores raw passwords. Apps Script verifies each Firebase ID token with Identity Toolkit before reading or changing room data.

Existing room members are linked to the Firebase UID the first time they join with their existing Room ID and PIN. Their room records and Secret ownership stay attached to the same member row.

After account creation, SharedWish displays a one-time recovery code. Store it somewhere safe. If the Firebase password is forgotten, use the Pulihkan tab with the username and recovery code. Each recovery rotates the code and starts a 30-day app session; save the replacement code. The recovery code does not change the Firebase password, so the account can continue using the recovery code if the password is no longer available.

Usernames are mapped to non-deliverable internal Firebase addresses, so Firebase password-reset email is intentionally not used. Recovery is handled by the one-time code stored as a hash in Apps Script Script Properties.
