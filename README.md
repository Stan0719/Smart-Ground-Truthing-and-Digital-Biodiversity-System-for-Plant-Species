# Smart-Ground-Truthing-and-Digital-Biodiversity-System-for-Plant-Species

The active website uses Vue components, a Node.js backend and PostgreSQL. Project Python source files and their launchers have been removed. Historical Python-based face, AI and serial tools are not available; no replacement recognition or hardware implementation is implied.

# For web:
cd web
npm install
npm run dev

# Historical prototype-only test accounts (not PostgreSQL backend credentials):
account: admin@niah.com
password: admin123

account: officer@niah.com
password: officer123

# For App:
cd mobileapp
npm install
npx expo start



cd mobileapp
npm install @react-navigation/native @react-navigation/native-stack @react-navigation/bottom-tabs
npx expo install @expo/vector-icons
npx expo install expo-camera
npx expo install expo-location
npx expo install expo-image-picker

npx expo start






# Smart Ground-Truthing and Digital Biodiversity System for Plant Species
## Project Setup and Running Instructions
This guide explains how to set up and run the Plant Conservation Management System locally using Visual Studio Code.

It covers:
- Backend API
- Web application
- Mobile application
- Database connection
- Troubleshooting

---

## 1. Prerequisites
Before running the project, make sure you have installed:

- [Node.js](https://nodejs.org/)
- npm (included with Node.js)
- [Visual Studio Code](https://code.visualstudio.com/)
- Git
- Internet connection (for Supabase database access)

Clone the team's GitHub repository if you have not downloaded it:

```bash
git clone https://github.com/Stan0719/Smart-Ground-Truthing-and-Digital-Biodiversity-System-for-Plant-Species.git
```

Open the downloaded project folder in VS Code.

---

## 2. Project Structure
The project contains the following main folders:

```text
Smart-Ground-Truthing-and-Digital-Biodiversity-System-for-Plant-Species/
│
├── plant-conservation-backend/   # Main backend API
│
├── web/                          # Web application and authentication server
│
├── mobileapp/                    # Mobile application
│
├── Ai/                           # AI-related components
│
├── IoT/                          # IoT-related components
│
├── shared/                       # Shared code and utilities
│
└── README.md
```

---

## 3. Environment Configuration
Before starting the application, make sure you have the required environment configuration files.

The backend and web application use environment variables to connect to Supabase and configure authentication and email services.

Required local configuration may include:

- `plant-conservation-backend/.env`
- `web/.env.server`
- Other environment files required by the mobile application.

**Important:**

1. Obtain the required environment configuration from the project administrator or team member.
2. Do not commit `.env` files to GitHub.
3. Never share database passwords, private API keys or other credentials publicly.
4. Make sure the Supabase database credentials are valid.
5. Make sure the required SSL certificate is available at:

```text
plant-conservation-backend/certs/prod-ca-2021.crt
```

---

## 4. Install Dependencies
Open the VS Code terminal at the project root.

Install backend dependencies:

```powershell
cd plant-conservation-backend
npm install
```

Install web application dependencies in another terminal:
```powershell
cd web
npm install
```

Install mobile application dependencies:
```powershell
cd mobileapp
npm install
```

Run these installation commands when setting up the project for the first time or when dependencies have changed.

---

## 5. Start the Backend API
The backend must be running before using the web or mobile application features that require the API.

**Step 1:** Open a new VS Code terminal.

**Step 2:** Navigate to the backend folder:

```powershell
cd plant-conservation-backend
```

**Step 3:** Start the backend:

```powershell
npm start
```

**Expected output:**

```text
Plant API listening on port 3000
```

The backend API runs at:

```text
http://localhost:3000
```

**Important:** Keep this terminal open while using the application.

Do not press `Ctrl + C` unless you want to stop the backend.

---

## 6. Start the Web Application
The web application uses Vue.js and Vite.

The `npm run dev` command starts both the web authentication server and the frontend development server.

**Step 1:** Open another VS Code terminal.

**Step 2:** Navigate to the web folder:

```powershell
cd web
```

**Step 3:** Start the web application:

```powershell
npm run dev
```

**Step 4:** Wait for the development server to start.

Vite normally displays a local URL similar to:

```text
http://localhost:5173/
```

Open the displayed URL in Google Chrome.

You should now be able to access the web application.

**Important:** Keep both the backend and web terminals running.

---

## 7. Start the Mobile Application
The mobile application uses Expo.

**Step 1:** Open another VS Code terminal.

**Step 2:** Navigate to the mobile application folder:

```powershell
cd mobileapp
```

**Step 3:** Install dependencies (first-time setup or after dependency changes):

```powershell
npm install
```

**Step 4:** Start the Expo development server:

```powershell
npx expo start
```

---

## 8. Database Information
The project uses Supabase PostgreSQL.

The main database schemas are:

| Schema | Purpose |
|---|---|
| `plant_app` | Main plant application data |
| `plant_auth` | Authentication and user management |
| `public` | Legacy database tables retained for compatibility and rollback |

The backend uses `plant_app` as its primary plant application schema.

The database connection is configured through environment variables.

Do not manually delete or modify legacy database tables without consulting the project team.

---

## 9. Running Order
Whenever you want to use the complete local system, follow this order:

| Order | Component | Command | Terminal |
|---|---|---|---|
| 1 | Backend API | `npm start` | Terminal 1 |
| 2 | Web application | `npm run dev` | Terminal 2 |
| 3 | Mobile application | Follow `mobileapp/package.json` scripts | Terminal 3 |

Keep the required terminals open while using the applications.

---

## 10. Stopping the Application
To stop a running development server:

1. Select its terminal in VS Code.
2. Press:

```text
Ctrl + C
```

Repeat this for each running server.

---

## 11. Troubleshooting
### Backend cannot connect to PostgreSQL

Check:
- Whether the `.env` file exists.
- Whether the Supabase database credentials are correct.
- Whether the internet connection is available.
- Whether the SSL certificate is available.

### Port 3000 is already in use
Another process may already be running on port 3000.
Stop the previous backend process before starting another one.

### Website cannot connect to the backend
Check:
- Whether the backend is running.
- Whether the backend API URL is configured correctly.
- Whether the frontend and backend environment configurations are correct.

### EmailJS temporary password email fails
Check:
- EmailJS Service ID.
- EmailJS Template ID.
- EmailJS Public Key.
- EmailJS Private Key.
- EmailJS Account → Security settings.

Do not create duplicate staff accounts when email delivery fails. The account may already have been created.

---

## 12. Important Reminders for Team Members
- Always pull the latest changes from GitHub before starting new development:

```bash
git pull origin main
```

- Do not commit `.env` files or private credentials.
- Do not delete database tables without team approval.
- Keep the backend running while testing the website or mobile application.
- Coordinate with teammates before changing shared database configurations.

---

**Repository:** [Smart Ground-Truthing and Digital Biodiversity System for Plant Species](https://github.com/Stan0719/Smart-Ground-Truthing-and-Digital-Biodiversity-System-for-Plant-Species)

**Development environment:** Visual Studio Code, Node.js, Vue.js, Vite, Express.js and Supabase PostgreSQL.