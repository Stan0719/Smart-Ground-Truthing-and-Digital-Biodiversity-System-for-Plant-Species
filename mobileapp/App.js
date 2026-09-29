import React from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { Ionicons } from "@expo/vector-icons";

import HomeScreen from "./screens/Home";
import PlantsScreen from "./screens/Plant";
import PlantDetailsScreen from "./screens/PlantDetail";
import ScanScreen from "./screens/Scan";
import MapScreen from "./screens/Map";
import AccountScreen from "./screens/Account";
import LoginScreen from "./screens/Login";
import BotanistDashboardScreen from "./screens/BotanistDashboard";
import AddPlantScreen from "./screens/AddPlant";
import EditPlantScreen from "./screens/EditPlant";

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

const theme = {
  light: "#DEF9C4",
  secondary: "#9CDBA6",
  primary: "#50B498",
  dark: "#468585",
};

function HomeStack() {
  return (
    <Stack.Navigator>
      <Stack.Screen
        name="Home"
        component={HomeScreen}
        options={{ headerShown: false }}
      />
    </Stack.Navigator>
  );
}

function PlantsStack() {
  return (
    <Stack.Navigator>
      <Stack.Screen
        name="Plants"
        component={PlantsScreen}
        options={{ headerShown: false }}
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

function ScanStack() {
  return (
    <Stack.Navigator>
      <Stack.Screen
        name="Scan"
        component={ScanScreen}
        options={{ headerShown: false }}
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

function MapStack() {
  return (
    <Stack.Navigator>
      <Stack.Screen
        name="Map"
        component={MapScreen}
        options={{ headerShown: false }}
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

function AccountStack() {
  return (
    <Stack.Navigator>
      <Stack.Screen
        name="Account"
        component={AccountScreen}
        options={{ headerShown: false }}
      />

      <Stack.Screen
        name="Login"
        component={LoginScreen}
        options={{ headerShown: false }}
      />

      <Stack.Screen
        name="BotanistDashboard"
        component={BotanistDashboardScreen}
        options={{
          title: "Botanist Dashboard",
          headerTintColor: theme.dark,
          headerStyle: {
            backgroundColor: theme.light,
          },
        }}
      />

      <Stack.Screen
        name="AddPlant"
        component={AddPlantScreen}
        options={{
          title: "Add Plant",
          headerTintColor: theme.dark,
          headerStyle: {
            backgroundColor: theme.light,
          },
        }}
      />

      <Stack.Screen
        name="EditPlant"
        component={EditPlantScreen}
        options={{
          title: "Edit Plant",
          headerTintColor: theme.dark,
          headerStyle: {
            backgroundColor: theme.light,
          },
        }}
      />
    </Stack.Navigator>
  );
}

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

        tabBarIcon: ({ focused, color, size }) => {
          let iconName;

          if (route.name === "HomeTab") {
            iconName = focused ? "home" : "home-outline";
          } else if (route.name === "PlantsTab") {
            iconName = focused ? "leaf" : "leaf-outline";
          } else if (route.name === "ScanTab") {
            iconName = focused ? "scan" : "scan-outline";
          } else if (route.name === "MapTab") {
            iconName = focused ? "map" : "map-outline";
          } else if (route.name === "AccountTab") {
            iconName = focused ? "person" : "person-outline";
          }

          return (
            <Ionicons
              name={iconName}
              size={route.name === "ScanTab" ? 28 : size}
              color={color}
            />
          );
        },
      })}
    >
      <Tab.Screen
        name="HomeTab"
        component={HomeStack}
        options={{ title: "Home" }}
      />

      <Tab.Screen
        name="PlantsTab"
        component={PlantsStack}
        options={{ title: "Plants" }}
      />

      <Tab.Screen
        name="ScanTab"
        component={ScanStack}
        options={{ title: "Scan" }}
      />

      <Tab.Screen
        name="MapTab"
        component={MapStack}
        options={{ title: "Map" }}
      />

      <Tab.Screen
        name="AccountTab"
        component={AccountStack}
        options={{ title: "Account" }}
      />
    </Tab.Navigator>
  );
}

export default function App() {
  return (
    <NavigationContainer>
      <MainTabs />
    </NavigationContainer>
  );
}
