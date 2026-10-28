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





## Plant Database Integration

The plant species API is deployed on Render and connected to a Supabase PostgreSQL database. The Admin Dashboard retrieves the plant species count from the API.

**Backend URL:** https://smart-ground-truthing-and-digital.onrender.com

### How to Run Locally
1. Install [Node.js](https://nodejs.org/) and Git.

2. Clone the repository:
   ```bash
   git clone https://github.com/Stan0719/Smart-Ground-Truthing-and-Digital-Biodiversity-System-for-Plant-Species.git
   ```

3. Open the project folder in VS Code and run:
   ```bash
   cd web
   npm install
   npm run dev
   ```

4. Open the local URL shown in the terminal, usually `http://localhost:5173`.

### Test the API
Open the following URL to check whether the plant species API is working:

https://smart-ground-truthing-and-digital.onrender.com/api/species

The API currently returns two sample species: Mango and Pitcher plant.

**Note:** The Vite proxy in `web/vite.config.ts` routes local plant API requests to the local Node.js backend. Local authentication and plant data now use private PostgreSQL schemas. Follow [the PostgreSQL migration guide](docs/postgresql-migration.md) for completed cutover checks and the remaining administrator-login and deployment work.