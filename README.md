# Clean by Lesa LLC

Website with customer accounts, a booking page, a private admin panel, local SQLite storage, required space photos, and a fixed $50 Zelle deposit. Remaining cleaning details and price are arranged directly with Lesa.

## Start on Windows

1. Install Node.js 22 or newer from [nodejs.org](https://nodejs.org) if it is not installed.
2. Double-click **Start Website.bat**.
3. Use the address `http://localhost:3101` that opens. Keep the **Clean by Lesa Server** window open. Do not use a `C:\...` file path for account sign-in or bookings.
4. Open `http://localhost:3101/admin.html`. On the first run, the server window prints the admin email and temporary password. Save those and change the password in the admin panel.

Customer accounts, bookings, and uploaded images are saved under `data/` on this computer. There are no npm packages to install, database accounts to link, or card-payment keys to enter.

## Prepare a deployment bundle

Run `npm run build` from the project folder. This creates `dist/` with the site pages, assets, `server.js`, and `package.json`. It does not copy the local database, session key, or customer uploads. Deploy the contents of `dist/` to a Node.js host and use `npm start` as its start command. Read `dist/README.md` for the required Node version and persistent storage settings.

## Customer quote and payment steps

1. The customer creates an account at `http://localhost:3101/signup.html` or signs in at `http://localhost:3101/login.html`.
2. On `account.html`, they choose their service, enter their address and preferred schedule, and upload at least one photo of the space.
3. After submitting the request, the customer sees Lesa's Zelle QR code and the fixed **$50 deposit**. They pay in their bank app and upload a screenshot of the payment confirmation.
4. The booking remains **Not Paid** while the screenshot is waiting for review. Lesa verifies the transfer in her bank and changes the payment status to **Paid** in the admin panel.
5. After Lesa marks the deposit Paid, the customer sees the confirmation and Lesa contacts them directly to discuss the cleaning, price, and scheduling. The rest of the service payment is arranged outside the website.

Space photos and payment screenshots must be JPG, PNG, WebP, or GIF, up to 5 MB each. Booking requests allow up to five photos and 15 MB total. Uploaded files are stored privately; customers can view their own files and the admin can view all of them.

Zelle does not automatically notify this website when money arrives, so Lesa must verify each transfer in her bank before marking it Paid. The customer-facing payment status has only two values: **Paid** and **Not Paid**.

## Admin panel

Go directly to `http://localhost:3101/admin.html` and sign in with the admin credentials printed the first time the server starts. This is a separate login; no customer login is needed first. The panel shows each account booking, customer photos, any Zelle payment screenshot, a two-choice booking status (**Scheduled** or **Not Scheduled**), and the two-choice deposit status (**Paid** or **Not Paid**).

## Internet hosting

`Start Website.bat` runs the app on this computer. To accept customer bookings over the internet, the Node app must be hosted online with HTTPS and persistent disk storage. Keep the `data/` folder on persistent storage so accounts, booking details, and uploaded images survive restarts.

## Pages

- `index.html` — Home
- `residential.html` — Residential packages and add-ons
- `commercial.html` — Commercial services
- `how-it-works.html` — New-client information
- `about.html` — Brand story
- `gallery.html` — Gallery
- `faq.html` — Frequently asked questions
- `login.html` — Customer sign in
- `signup.html` — Customer account creation
- `auth.html` — Compatibility redirect to sign in
- `account.html` — The customer booking, required photo upload, $50 Zelle deposit QR, screenshot upload, and status page
- `admin.html` — Admin login, booking dashboard, and password change

## Customize

- Edit palette and typography in `css/style.css`.
- Update page content and photos in the HTML files.
- SQLite tables and private uploads are created automatically inside `data/`.
- `ADMIN_EMAIL` and `ADMIN_PASSWORD` can be set before the first run. Keep admin credentials private.
