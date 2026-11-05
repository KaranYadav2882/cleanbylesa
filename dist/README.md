# Clean by Lesa deployment bundle

This folder contains the website and its Node.js server. It requires Node.js 22.5 or newer and uses Node's built-in SQLite support; there are no package dependencies to install.

## Deploy

Upload the contents of this folder to a Node.js host. Set the start command to `npm start`. The server listens on the host-provided `PORT` and binds to `0.0.0.0`.

Set these environment variables on the host:

- `NODE_ENV=production` so browser sessions use secure cookies over HTTPS.
- `DATA_DIR` to a persistent writable disk directory. This stores the SQLite database, uploaded customer photos/payment screenshots, and session signing key. Keep this directory across deploys and restarts.
- Optionally, `ADMIN_EMAIL` to set the initial admin email (defaults to `cleanbylesa@gmail.com`).
- Optionally, `ADMIN_PASSWORD` for a known initial admin password. Set it before the first deploy. If unset, the server generates a temporary password and prints it to the service logs on first start.

The host must provide persistent disk storage for `DATA_DIR`; ephemeral container storage can lose accounts, bookings, and uploads when the host restarts or redeploys. Use an HTTPS custom domain or the host's HTTPS URL for customer logins and uploads.

Open `/` for the public site, `/login.html` and `/signup.html` for customer accounts, and `/admin.html` for the admin panel. Customers pay a fixed $50 Zelle deposit using the QR code in their account and upload payment proof. Lesa verifies the transfer manually in her bank and changes payment status to Paid. Other service costs are arranged directly with the customer.
