import React, { useEffect, useState } from "react";

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

function PlantsStack() {
  return (
    <Stack.Navigator>

      <Stack.Screen
        name="Plants"
        component={PlantsScreen}
        options={{
          headerShown: false,
        }}
      />

      <Stack.Screen
        name="SpeciesDetail"
        component={SpeciesDetailScreen}
        options={{
          headerShown: false,
        }}
      />

      <Stack.Screen
        name="Species"
        component={SpeciesScreen}
        options={{
          headerShown: false,
        }}
      />

      <Stack.Screen
        name="PlantDetails"
        component={PlantDetailsScreen}
        options={{
          title: "Plant Details",
          headerTintColor: theme.dark,
          headerStyle: {
            backgroundColor: theme.light,
          },
        }}
      />

    </Stack.Navigator>
  );
}


/* =========================================================
   SCAN STACK
========================================================= */

function ScanStack() {
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
        component={PlantDetailsScreen}
        options={{
          title: "Plant Details",

          headerTintColor: theme.dark,

          headerStyle: {
            backgroundColor: theme.light,
          },
        }}
      />

    </Stack.Navigator>
  );
}


/* =========================================================
   MAP STACK
========================================================= */

function MapStack() {
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
        component={PlantDetailsScreen}
        options={{
          title: "Plant Details",

          headerTintColor: theme.dark,

          headerStyle: {
            backgroundColor: theme.light,
          },
        }}
      />

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
        component={PlantDetailsScreen}
        options={{
          title: "Plant Details",
          headerTintColor: theme.dark,
          headerStyle: {
            backgroundColor: theme.light,
          },
        }}
      />

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
        component={PlantsStack}
        options={{
          title: "Plants",
        }}
      />


      {/* SCAN */}
      <Tab.Screen
        name="ScanTab"
        component={ScanStack}
        options={{
          title: "Scan",
        }}
      />


      {/* MAP - BOTANIST ONLY */}
      {user?.role === "botanist" && (
        <Tab.Screen
          name="MapTab"
          component={MapStack}
          options={{
            title: "Map",
          }}
        />
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


  /* =======================================================
     LOGIN
  ======================================================= */

  function handleLogin(loggedInUser) {
    setUser(loggedInUser);
  }

  function handleLogout() {
    setUser(null);
  }


  return (
    <NavigationContainer
      ref={navigationRef}
      onReady={() => {
        if (homeRequest) navigationRef.navigate("MainTabs");
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
              onLogin={(loggedInUser) => {

                setUser(loggedInUser);

                props.navigation.replace(
                  "MainTabs"
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
              onLogout={() => {

                setUser(null);

                props.navigation.replace(
                  "Login"
                );

              }}
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
