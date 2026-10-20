# Loop — Short-video social network

An independent, runnable short-video social app starter built with Node.js and browser-native HTML/CSS/JavaScript. It is a new project and does not modify or depend on any other repository or deployment. The product direction is inspired by the short-video social category, but Loop uses its own name, visual identity and implementation.

## What is implemented

- Responsive desktop, tablet and mobile layout, including a bottom navigation bar on small screens.
- Account registration and login, password hashing with Node's `scrypt`, signed expiring bearer tokens, and profile editing.
- Video upload and playback for MP4, WebM, MOV and M4V files (100 MB default maximum).
- For You and Following feeds, creator discovery/search, creator profiles, follow/unfollow, likes, comments and share-link copying.
- JSON-file persistence for local development and HTTP byte-range video streaming for seeking in players.
- Automated Node test for health, registration, login and protected profile routes.

## Requirements

- Node.js 20 or newer (Node 22 recommended).
- No third-party npm packages are required for this starter.

## Run locally

1. Extract the ZIP.
2. Open a terminal in the `loop-short-video-project` folder.
3. Run `npm test`.
4. Run `npm start`.
5. Open `http://localhost:3000` in a browser.

On a phone, open the computer's LAN IP address on the same Wi-Fi network, e.g. `http://192.168.1.10:3000`. The firewall must allow the chosen port. Do not expose this development server directly to the public internet.

## Configuration

Copy `.env.example` to `.env` and configure `PORT`, `APP_SECRET` and `MAX_UPLOAD_MB` for your environment. Node does not automatically load `.env` in every supported version; export the variables in your shell or use a deployment environment's variable settings. Never use the development fallback secret in production.

## Project structure

```text
loop-short-video-project/
├── data/                 # local JSON database created at runtime
├── public/
│   ├── index.html        # page structure and dialogs
│   ├── styles.css        # responsive visual system
│   └── app.js            # client UI and API integration
├── tests/app.test.js     # integration test
├── uploads/              # uploaded video files (local only)
├── .env.example
├── .gitignore
├── package.json
├── README.md
└── server.js             # API, authentication, upload and streaming
```

## API overview

- `GET /api/health`
- `POST /api/auth/register`, `POST /api/auth/login`
- `GET/PATCH /api/me`
- `GET /api/videos?feed=for-you|following`
- `POST /api/videos/upload` (multipart form data)
- `POST /api/videos/:id/like`
- `GET/POST /api/videos/:id/comments`
- `GET /api/users/:id-or-username`
- `POST /api/users/:id/follow`

## Important production gaps

This is a working local starter, not a production-scale TikTok replacement. Before a public launch, move persistence to a managed database, store video files in private object storage behind a CDN, add robust upload scanning and transcoding, rate limits, email verification and account recovery, moderation/report/block tools, privacy controls, abuse detection, a real recommendation system, analytics, backups, observability and secure deployment configuration. The local JSON database is not safe for concurrent multi-instance deployment. This version does **not** include live streaming, licensed music catalogue, direct messages, ad revenue, creator payouts, effects/filters, duet/stitch, or a production recommendation algorithm.

## Security and content notes

Use only media you own or have permission to distribute. Configure a unique long `APP_SECRET` and HTTPS before any real deployment. The included app is a starter for development and must receive a security review before handling real user data.
