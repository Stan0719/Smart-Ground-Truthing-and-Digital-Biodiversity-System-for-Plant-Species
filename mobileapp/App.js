import React from "react";

import {
  NavigationContainer,
} from "@react-navigation/native";

import {
  createBottomTabNavigator,
} from "@react-navigation/bottom-tabs";

import {
  createNativeStackNavigator,
} from "@react-navigation/native-stack";

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


/* =========================================================
   MAIN BOTTOM TABS
========================================================= */

function MainTabs() {
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


      {/* MAP */}
      <Tab.Screen
        name="MapTab"
        component={MapStack}
        options={{
          title: "Map",
        }}
      />


      {/* ACCOUNT */}
      <Tab.Screen
        name="AccountTab"
        component={LoginScreen}
        options={{
          title: "Account",
        }}
      />

    </Tab.Navigator>
  );
}


/* =========================================================
   ROOT APP NAVIGATION
========================================================= */

export default function App() {

  return (
    <NavigationContainer>

      <RootStack.Navigator
        initialRouteName="Login"

        screenOptions={{
          headerShown: false,
        }}
      >


        {/* ================================================
            FIRST PAGE
            No bottom tabs
        ================================================= */}

        <RootStack.Screen
          name="Login"
          component={LoginScreen}
        />


        {/* ================================================
            MAIN APP
            Bottom tabs become visible here
        ================================================= */}

        <RootStack.Screen
          name="MainTabs"
          component={MainTabs}
        />


        {/* ================================================
            BOTANIST DASHBOARD
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


      </RootStack.Navigator>

    </NavigationContainer>
  );
}