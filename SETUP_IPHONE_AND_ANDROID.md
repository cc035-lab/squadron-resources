# Squadron Resources: iPhone and Android (web version)

The web version is the same app as the Android APK. It runs in Safari (iPhone/iPad) and Chrome (Android, Windows, Mac), works offline after the first visit, and keeps all member data on the device.

## One-time: put it on GitHub Pages (about 10 minutes, use a computer)

1. Sign in to GitHub (cc035-lab) and click **New repository**. Name it `squadron-resources`, choose **Public** (free GitHub Pages requires it), and click **Create repository**.
2. Click **uploading an existing file**. Unzip `Squadron_Resources_Web_v1.4.zip` and drag **everything inside it** (including the `icons` and `vendor` folders) into the page. Click **Commit changes**.
3. Open **Settings → Pages**. Under *Build and deployment*, set Source to **Deploy from a branch**, Branch **main**, folder **/ (root)**, and click **Save**.
4. After a minute or two the site is at: `https://cc035-lab.github.io/squadron-resources/`

The repository contains only app code. **Never upload reports or backup files to it**: the repository is public.
Turn on two-factor authentication for the GitHub account, since whoever controls it controls the app's code.

## Install on a phone

**iPhone/iPad:** open the link in **Safari** → tap **Share** → **Add to Home Screen** → **Add**. Open it once from the new icon while online.

**Android:** open the link in **Chrome** → **⋮** → **Add to Home screen** (or **Install app**).

After that it works with no internet connection.

## Importing reports

In eServices, download the **Excel (.xlsx)** versions:
- Duty Assignment Report
- All Qualification Listing
- Specialty Track Report (the .zip is fine)
- Cadet Protection Course Completion Report

In the app: **Update Reports** → any **Select** button → pick the file. The app recognizes which report it is. PDF versions can only be read by the Android APK.

## Things to know

- Data lives only in that browser on that device. **Deleting the home-screen icon (iPhone) or clearing Chrome's site data (Android) erases it.** Make a secure backup (PIN) regularly.
- Secure backups open on any device, including the Android APK, with the same PIN.
- Saving a backup on iPhone: tap **Save backup**, then **Save to Files**.

## Releasing an update

Upload the changed files to the repository (replace existing ones). Each release changes the version in `sw.js`, which tells phones to fetch the new files. Users get the update the next time they open the app while online, then reopen it.
