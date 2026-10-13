import { faceDiagnostic } from "./utils/faceApi";
import React, { useEffect, useRef, useState } from "react";

import {
  NavigationContainer,
  useNavigationContainerRef,
} from "expo-router/react-navigation";

import {
  createBottomTabNavigator,
} from "expo-router/js-tabs";

import {
  createNativeStackNavigator,
} from "expo-router/native-stack";

import { ActivityIndicator, AppState, View, Text } from "react-native";
import { faceSession } from "./utils/faceSession";
import { Ionicons } from "@expo/vector-icons";


// Screens
import HomeScreen from "./screens/Home";
import PlantsScreen from "./screens/Plant";
import PlantDetailsScreen from "./screens/PlantDetail";
import ScanScreen from "./screens/Scan";
import MapScreen from "./screens/Map";
import LoginScreen from "./screens/Login";
import BotanistDashboardScreen from "./screens/BotanistDashboard";
import AddPlantScreen from "./screens/AddPlant";
import EditPlantScreen from "./screens/EditPlant";
import VisitorRegisterScreen from "./screens/VisitorRegister";
import PlantQRCodeScreen from "./screens/PlantQRCode";
import AccountScreen from "./screens/Account";
import FavouritePlantsScreen from "./screens/FavouritePlants";
import ScanHistoryScreen from "./screens/ScanHistory";
import SpeciesScreen from "./screens/Species";
import SpeciesDetailScreen from "./screens/SpeciesDetail";
import BotanistPlantDetailScreen from "./screens/BotanistPlantDetail";
import AddObservationScreen from "./screens/AddObservation";


const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();
const RootStack = createNativeStackNavigator();


const theme = {
  light: "#DEF9C4",
  secondary: "#9CDBA6",
  primary: "#50B498",
  dark: "#468585",
};


/* =========================================================
   HOME STACK
========================================================= */

function HomeStack() {
  return (
    <Stack.Navigator>

      <Stack.Screen
        name="Home"
        component={HomeScreen}
        options={{
          headerShown: false,
        }}
      />

    </Stack.Navigator>
  );
}


/* =========================================================
   PLANTS STACK
========================================================= */

function PlantsStack({ user }) {
  return (
    <Stack.Navigator>

      <Stack.Screen
        name="Plants"
        options={{
          headerShown: false,
        }}
      >
        {(props) => (
          <PlantsScreen
            {...props}
            user={user}
          />
        )}
      </Stack.Screen>

      <Stack.Screen
        name="SpeciesDetail"
        options={{
          headerShown: false,
        }}
      >
        {(props) => (
          <SpeciesDetailScreen
            {...props}
            user={user}
          />
        )}
      </Stack.Screen>

      <Stack.Screen
        name="Species"
        options={{
          headerShown: false,
        }}
      >
        {(props) => (
          <SpeciesScreen
            {...props}
            user={user}
          />
        )}
      </Stack.Screen>

      <Stack.Screen
        name="PlantDetails"
        options={{
          title: "Plant Details",
          headerTintColor: theme.dark,
          headerStyle: {
            backgroundColor: theme.light,
          },
        }}
      >
        {(props) => (
          <PlantDetailsScreen
            {...props}
            user={user}
          />
        )}
      </Stack.Screen>

    </Stack.Navigator>
  );
}


/* =========================================================
   SCAN STACK
========================================================= */

function ScanStack({ user }) {
  return (
    <Stack.Navigator>

      <Stack.Screen
        name="Scan"
        component={ScanScreen}
        options={{
          headerShown: false,
        }}
      />

      <Stack.Screen
        name="PlantDetails"
        options={{
          title: "Plant Details",

          headerTintColor: theme.dark,

          headerStyle: {
            backgroundColor: theme.light,
          },
        }}
      >
        {(props) => (
          <PlantDetailsScreen
            {...props}
            user={user}
          />
        )}
      </Stack.Screen>

    </Stack.Navigator>
  );
}


/* =========================================================
   MAP STACK
========================================================= */

function MapStack({ user }) {
  return (
    <Stack.Navigator>

      <Stack.Screen
        name="Map"
        component={MapScreen}
        options={{
          headerShown: false,
        }}
      />

      <Stack.Screen
        name="PlantDetails"
        options={{
          title: "Plant Details",

          headerTintColor: theme.dark,

          headerStyle: {
            backgroundColor: theme.light,
          },
        }}
      >
        {(props) => (
          <PlantDetailsScreen
            {...props}
            user={user}
          />
        )}
      </Stack.Screen>

    </Stack.Navigator>
  );
}

function AccountStack({
  user,
  onLogout,
}) {
  return (
    <Stack.Navigator>

      <Stack.Screen
        name="Account"
        options={{
          headerShown: false,
        }}
      >
        {(props) => (
          <AccountScreen
            {...props}
            user={user}
            onLogout={onLogout}
          />
        )}
      </Stack.Screen>

      <Stack.Screen
        name="FavouritePlants"
        component={FavouritePlantsScreen}
        options={{
          title: "Favourite Plants",
          headerTintColor: theme.dark,
          headerStyle: {
            backgroundColor: theme.light,
          },
        }}
      />

      {/* Plant Details */}
      <Stack.Screen
        name="PlantDetails"
        options={{
          title: "Plant Details",
          headerTintColor: theme.dark,
          headerStyle: {
            backgroundColor: theme.light,
          },
        }}
      >
        {(props) => (
          <PlantDetailsScreen
            {...props}
            user={user}
          />
        )}
      </Stack.Screen>

      <Stack.Screen
        name="ScanHistory"
        component={ScanHistoryScreen}
        options={{
          headerShown: false,
        }}
      />

    </Stack.Navigator>
  );
}

/* =========================================================
   MAIN BOTTOM TABS
========================================================= */

function MainTabs({
  user,
  onLogin,
  onLogout,
}) {

  return (
    <Tab.Navigator

      screenOptions={({ route }) => ({

        headerShown: false,

        tabBarActiveTintColor: theme.primary,

        tabBarInactiveTintColor: "#7A8A80",

        tabBarStyle: {
          height: 65,

          paddingBottom: 8,
          paddingTop: 5,

          backgroundColor: "#FFFFFF",

          borderTopWidth: 0,

          elevation: 10,
        },

        tabBarLabelStyle: {
          fontSize: 11,

          fontWeight: "600",
        },


        tabBarIcon: ({
          focused,
          color,
          size,
        }) => {

          let iconName;


          if (route.name === "HomeTab") {

            iconName = focused
              ? "home"
              : "home-outline";

          } else if (route.name === "PlantsTab") {

            iconName = focused
              ? "leaf"
              : "leaf-outline";

          } else if (route.name === "ScanTab") {

            iconName = focused
              ? "scan"
              : "scan-outline";

          } else if (route.name === "MapTab") {

            iconName = focused
              ? "map"
              : "map-outline";

          } else if (route.name === "AccountTab") {

            iconName = focused
              ? "person"
              : "person-outline";

          }


          return (
            <Ionicons
              name={iconName}
              size={
                route.name === "ScanTab"
                  ? 28
                  : size
              }
              color={color}
            />
          );
        },

      })}
    >


      {/* HOME */}
      <Tab.Screen
        name="HomeTab"
        component={HomeStack}
        options={{
          title: "Home",
        }}
      />


      {/* PLANTS */}
      <Tab.Screen
        name="PlantsTab"
        options={{
          title: "Plants",
        }}
      >
        {(props) => (
          <PlantsStack
            {...props}
            user={user}
          />
        )}
      </Tab.Screen>


      {/* SCAN */}
      <Tab.Screen
        name="ScanTab"
        options={{
          title: "Scan",
        }}
      >
        {(props) => (
          <ScanStack
            {...props}
            user={user}
          />
        )}
      </Tab.Screen>


      {/* MAP - BOTANIST ONLY */}
      {user?.role === "botanist" && (
        <Tab.Screen
          name="MapTab"
          options={{
            title: "Map",
          }}
        >
          {(props) => (
            <MapStack
              {...props}
              user={user}
            />
          )}
        </Tab.Screen>
      )}


      {/* ACCOUNT / BOTANIST DASHBOARD */}
      {/* ACCOUNT / BOTANIST DASHBOARD */}
      <Tab.Screen
        name="AccountTab"
        options={{
          title: user?.role === "botanist"
            ? "Dashboard"
            : "Account",
        }}
      >
        {(props) => {

          // No user logged in
          if (!user) {
            return (
              <LoginScreen
                {...props}
                onLogin={onLogin}
              />
            );
          }


          // Botanist
          if (user.role === "botanist") {
            return (
              <BotanistDashboardScreen
                {...props}
                route={{
                  ...props.route,
                  params: {
                    botanist: user,
                  },
                }}
                onLogout={onLogout}
              />
            );
          }


          // Visitor
          return (
            <AccountStack
              user={user}
              onLogout={onLogout}
            />
          );
        }}
      </Tab.Screen>

          </Tab.Navigator>
        );
      }


/* =========================================================
   ROOT APP NAVIGATION
========================================================= */

export default function App({ homeRequest }) {
  const navigationRef = useNavigationContainerRef();
  useEffect(() => {
    if (homeRequest && navigationRef.isReady()) {
      navigationRef.navigate("MainTabs");
    }
  }, [homeRequest, navigationRef]);

  const [user, setUser] = useState(null);
  const [restoringSession, setRestoringSession] = useState(true);
  const authGeneration = useRef(0);
  const faceNavigationReference = useRef(null);
  const restoredUser = useRef(null);
  const applyServerUser = (verifiedUser) => {
    setUser(verifiedUser);
    if (navigationRef.isReady()) navigationRef.reset({ index: 0, routes: [{ name: "MainTabs", params: { screen: verifiedUser.role === "botanist" ? "AccountTab" : "HomeTab" } }] });
    else restoredUser.current = verifiedUser;
  };
  useEffect(() => {
    let active = true;
    const generation = authGeneration.current;
    faceSession.restore().then((verifiedUser) => {
      if (active && generation === authGeneration.current && verifiedUser) applyServerUser(verifiedUser);
    }).catch(() => {}).finally(() => { if (active) setRestoringSession(false); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    let active = true;
    async function revalidate() {
      if (!faceSession.hasSession()) return;
      const generation = authGeneration.current;
      try {
        const verifiedUser = await faceSession.restore();
        if (active && generation === authGeneration.current && verifiedUser) setUser(verifiedUser);
      } catch {
        if (active && generation === authGeneration.current) {
          setUser(null);
          if (navigationRef.isReady()) navigationRef.reset({ index: 0, routes: [{ name: "Login" }] });
        }
      }
    }
    const listener = AppState.addEventListener("change", (state) => { if (state === "active") revalidate(); });
    const timer = setInterval(revalidate, 60000);
    return () => { active = false; listener.remove(); clearInterval(timer); };
  }, [navigationRef]);


  /* =======================================================
     LOGIN
  ======================================================= */

  function handleLogin(loggedInUser, metadata) {
    faceNavigationReference.current = metadata?.reference || null;
    authGeneration.current += 1;
    setUser(loggedInUser);
    if (metadata?.reference) faceDiagnostic("auth_context_updated", metadata.reference);
  }

  async function handleLogout() {
    authGeneration.current += 1;
    restoredUser.current = null;
    setUser(null);
    if (navigationRef.isReady()) navigationRef.reset({ index: 0, routes: [{ name: "Login" }] });
    try { await faceSession.logout(); }
    catch { /* Local session is already deleted; offline server session expires normally. */ }
  }


  if (restoringSession) return <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#244B47" }}><ActivityIndicator color="#DEF9C4" /><Text style={{ color: "white", padding: 16 }}>Checking saved login…</Text></View>;

  return (
    <NavigationContainer
      ref={navigationRef}
      onStateChange={() => {
        if (!faceNavigationReference.current) return;
        const current = navigationRef.getCurrentRoute();
        if (current?.name === "AccountTab" || current?.name === "HomeTab") {
          faceDiagnostic("navigation_observed", faceNavigationReference.current, { screen: current.name });
          faceNavigationReference.current = null;
        }
      }}
      onReady={() => {
        if (restoredUser.current) {
          const verifiedUser = restoredUser.current;
          restoredUser.current = null;
          applyServerUser(verifiedUser);
        } else if (homeRequest) navigationRef.navigate("MainTabs");
      }}
    >

      <RootStack.Navigator
        initialRouteName="Login"

        screenOptions={{
          headerShown: false,
        }}
      >


        {/* ================================================
            LOGIN PAGE
            First page without bottom tabs
        ================================================= */}

        <RootStack.Screen
          name="Login"
        >
          {(props) => (

            <LoginScreen
              {...props}
              onLogin={(loggedInUser, metadata) => {

                handleLogin(loggedInUser, metadata);

                props.navigation.replace(
                  "MainTabs", { screen: loggedInUser.role === "botanist" ? "AccountTab" : "HomeTab" }
                );

              }}
            />

          )}
        </RootStack.Screen>


        {/* ================================================
            VISITOR REGISTRATION
        ================================================= */}

        <RootStack.Screen
          name="VisitorRegister"
          component={VisitorRegisterScreen}
        />


        {/* ================================================
            MAIN APP
        ================================================= */}

        <RootStack.Screen
          name="MainTabs"
        >
          {(props) => (

            <MainTabs
              user={user}
              onLogin={handleLogin}
              onLogout={handleLogout}
            />

          )}
        </RootStack.Screen>


        {/* ================================================
            BOTANIST DASHBOARD
            Kept for other navigation if needed
        ================================================= */}

        <RootStack.Screen
          name="BotanistDashboard"
          component={BotanistDashboardScreen}

          options={{
            headerShown: true,

            title: "Botanist Dashboard",

            headerTintColor: theme.dark,

            headerStyle: {
              backgroundColor: theme.light,
            },
          }}
        />

        
        <RootStack.Screen
          name="BotanistPlantDetail"
          component={BotanistPlantDetailScreen}
          options={{
            headerShown: true,
            title: "Plant Details",
            headerTintColor: theme.dark,
            headerStyle: {
              backgroundColor: theme.light,
            },
          }}
        />

        <RootStack.Screen
          name="AddObservation"
          options={{
            headerShown: true,
            title: "Add New Observation",
            headerTintColor: theme.dark,
            headerStyle: {
              backgroundColor: theme.light,
            },
          }}
        >
          {(props) => (
            <AddObservationScreen
              {...props}
              user={user}
            />
          )}
        </RootStack.Screen>



        {/* ================================================
            ADD PLANT
        ================================================= */}

        <RootStack.Screen
          name="AddPlant"
          component={AddPlantScreen}

          options={{
            headerShown: true,

            title: "Add Plant",

            headerTintColor: theme.dark,

            headerStyle: {
              backgroundColor: theme.light,
            },
          }}
        />


        {/* ================================================
            EDIT PLANT
        ================================================= */}

        <RootStack.Screen
          name="EditPlant"
          component={EditPlantScreen}

          options={{
            headerShown: true,

            title: "Edit Plant",

            headerTintColor: theme.dark,

            headerStyle: {
              backgroundColor: theme.light,
            },
          }}
        />

        <RootStack.Screen
          name="PlantQRCode"
          component={PlantQRCodeScreen}
          options={{
            headerShown: true,
            title: "Plant QR Code",
            headerTintColor: theme.dark,
            headerStyle: {
              backgroundColor: theme.light,
            },
          }}
        />


      </RootStack.Navigator>

    </NavigationContainer>
  );
}
