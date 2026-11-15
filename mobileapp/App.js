import { t, useAppTranslation } from "./translations/i18n";
import { faceDiagnostic } from "./utils/faceApi";
import React, { useEffect, useRef, useState } from "react";

import {
  NavigationContainer,
  useNavigationContainerRef,
} from "@react-navigation/native";

import {
  createBottomTabNavigator,
} from "@react-navigation/bottom-tabs";

import {
  createNativeStackNavigator,
} from "@react-navigation/native-stack";

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
import BotanistDashboardScreen, { BotanistSubmissionsScreen, BotanistCorrectionRequestsScreen } from "./screens/BotanistDashboard";
import BotanistNotificationsScreen from "./screens/BotanistNotifications";
import NotificationObservationScreen from "./screens/NotificationObservation";
import AddPlantScreen from "./screens/AddPlant";
import AddSpeciesRequestScreen from "./screens/AddSpeciesRequest";
import EditPlantScreen from "./screens/EditPlant";
import EditSpeciesRequestScreen from "./screens/EditSpeciesRequest";
import RecordChangeReviewScreen from "./screens/RecordChangeReview";
import RecordVersionHistoryScreen from "./screens/RecordVersionHistory";
import VisitorRegisterScreen from "./screens/VisitorRegister";
import PlantQRCodeScreen from "./screens/PlantQRCode";
import AccountScreen from "./screens/Account";
import FavouritePlantsScreen from "./screens/FavouritePlants";
import ScanHistoryScreen from "./screens/ScanHistory";
import SpeciesScreen from "./screens/Species";
import SpeciesDetailScreen from "./screens/SpeciesDetail";
import BotanistPlantDetailScreen from "./screens/BotanistPlantDetail";
import BotanistSpeciesRequestDetailScreen from "./screens/BotanistSpeciesRequestDetail";
import BotanistMyDraftsScreen from "./screens/BotanistMyDrafts";
import FieldCollectionScreen from "./screens/FieldCollection";
import PersistentKnowledgeScreen from "./screens/PersistentKnowledge";
import BackButton from "./components/BackButton";


const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();
const RootStack = createNativeStackNavigator();


const theme = {
  light: "#DEF9C4",
  secondary: "#9CDBA6",
  primary: "#50B498",
  dark: "#468585",
};

function centeredDetailHeader({ route, navigation, title }) {
  const isHistoricalDetail = route.params?.historicalRecordDetail === true;
  const backLabel = isHistoricalDetail ? t("submissions.title") : null;

  return {
    headerShown: true,
    title,
    headerBackTitle: backLabel || undefined,
    headerBackVisible: false,
    headerTitleAlign: "center",
    headerTitleStyle: { fontSize: 17, fontWeight: "600", color: "#234A3C" },
    headerLeft: ({ label }) => navigation.canGoBack() ? (
      <BackButton
        label={backLabel || label || t("common.goBack")}
        accessibilityLabel={backLabel || label || t("common.goBack")}
        onPress={() => navigation.goBack()}
        variant="plain"
      />
    ) : null,
    headerTintColor: theme.dark,
    headerStyle: { backgroundColor: theme.light },
  };
}


/* =========================================================
   HOME STACK
========================================================= */

function HomeStack() {
  useAppTranslation();
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
  useAppTranslation();
  return (
    <Stack.Navigator>

      <Stack.Screen
        name="Plants"
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
          <PlantsScreen
            {...props}
            user={user}
          />
        )}
      </Stack.Screen>

      <Stack.Screen
        name="PlantDetails"
        options={{
          headerShown: false,
          title: t("navigation.plantDetails"),
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
  useAppTranslation();
  return (
    <Stack.Navigator>

      <Stack.Screen
        name="Scan"
        options={{
          headerShown: false,
        }}
      >
        {(props) => <ScanScreen {...props} user={user} />}
      </Stack.Screen>

      <Stack.Screen
        name="PlantDetails"
        options={{
          headerShown: false,
          title: t("navigation.plantDetails"),

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
  useAppTranslation();
  return (
    <Stack.Navigator>

      <Stack.Screen
        name="Map"
        options={{
          headerShown: false,
        }}
      >
        {(props) => <MapScreen {...props} user={user} />}
      </Stack.Screen>

      <Stack.Screen
        name="PlantDetails"
        options={{
          headerShown: false,
          title: t("navigation.plantDetails"),

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
  useAppTranslation();
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
        options={{
          headerShown: false,
          title: t("navigation.favouritePlants"),
          headerTintColor: theme.dark,
          headerStyle: {
            backgroundColor: theme.light,
          },
        }}
      >
        {(props) => <FavouritePlantsScreen {...props} user={user} />}
      </Stack.Screen>

      {/* Plant Details */}
      <Stack.Screen
        name="PlantDetails"
        options={{
          headerShown: false,
          title: t("navigation.plantDetails"),
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
        options={{
          headerShown: false,
        }}
      >
        {(props) => <ScanHistoryScreen {...props} user={user} />}
      </Stack.Screen>

      <Stack.Screen name="SpeciesDetail" options={{ headerShown: false }}>
        {(props) => <SpeciesDetailScreen {...props} user={user} />}
      </Stack.Screen>

      <Stack.Screen name="Species" options={{ headerShown: false }}>
        {(props) => <PlantsScreen {...props} user={user} />}
      </Stack.Screen>

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
  useAppTranslation();

  return (
    <Tab.Navigator

      screenOptions={({ route }) => ({

        headerShown: false,

        tabBarActiveTintColor: theme.dark,

        tabBarInactiveTintColor: "#6D7F75",

        tabBarStyle: {
          height: 65,

          paddingBottom: 8,
          paddingTop: 5,

          backgroundColor: "#F7FBF4",

          borderTopWidth: 1,
          borderTopColor: "#E2EDE0",

          elevation: 4,
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
          title: t("navigation.home"),
        }}
      />


      {/* PLANTS */}
      <Tab.Screen
        name="PlantsTab"
        options={{
          title: t("navigation.plants"),
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
          title: t("navigation.scan"),
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
            title: t("navigation.map"),
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
            ? t("common.dashboard")
            : t("account.account"),
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
  useAppTranslation();
  const navigationRef = useNavigationContainerRef();
  useEffect(() => {
    if (homeRequest && navigationRef.isReady()) {
      navigationRef.navigate("MainTabs");
    }
  }, [homeRequest, navigationRef]);

  const [user, setUser] = useState(null);
  const userRef = useRef(null);
  const [restoringSession, setRestoringSession] = useState(true);
  const authGeneration = useRef(0);
  const faceNavigationReference = useRef(null);
  const restoredUser = useRef(null);
  const applyServerUser = (verifiedUser) => {
    userRef.current = verifiedUser;
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
      const generation = authGeneration.current;
      try {
        const verifiedUser = await faceSession.restore();
        if (active && generation === authGeneration.current) {
          if (verifiedUser) {
            userRef.current = verifiedUser;
            setUser(verifiedUser);
          } else if (userRef.current) {
            userRef.current = null;
            setUser(null);
            if (navigationRef.isReady() && navigationRef.getCurrentRoute()?.name !== "Login")
              navigationRef.reset({ index: 0, routes: [{ name: "Login" }] });
          }
        }
      } catch (error) {
        if (error.transient === true || [502, 503, 504].includes(error.status)) return;
        if (active && generation === authGeneration.current) {
          const hadAuthenticatedUser = Boolean(userRef.current);
          userRef.current = null;
          setUser(null);
          if (hadAuthenticatedUser && navigationRef.isReady() && navigationRef.getCurrentRoute()?.name !== "Login")
            navigationRef.reset({ index: 0, routes: [{ name: "Login" }] });
        }
      }
    }
    const listener = AppState.addEventListener("change", (state) => { if (state === "active") revalidate(); });
    const unsubscribe = faceSession.subscribe?.(({ authenticated }) => {
      if (!active || authenticated) return;
      const hadAuthenticatedUser = Boolean(userRef.current);
      authGeneration.current += 1;
      userRef.current = null;
      setUser(null);
      if (hadAuthenticatedUser && navigationRef.isReady() && navigationRef.getCurrentRoute()?.name !== "Login")
        navigationRef.reset({ index: 0, routes: [{ name: "Login" }] });
    });
    const timer = setInterval(revalidate, 60000);
    return () => { active = false; listener.remove(); unsubscribe?.(); clearInterval(timer); };
  }, [navigationRef, faceSession]);


  /* =======================================================
     LOGIN
  ======================================================= */

  function handleLogin(loggedInUser, metadata) {
    faceNavigationReference.current = metadata?.reference || null;
    authGeneration.current += 1;
    userRef.current = loggedInUser;
    setUser(loggedInUser);
    if (metadata?.reference) faceDiagnostic("auth_context_updated", metadata.reference);
  }

  async function handleLogout() {
    authGeneration.current += 1;
    restoredUser.current = null;
    userRef.current = null;
    setUser(null);
    if (navigationRef.isReady()) navigationRef.reset({ index: 0, routes: [{ name: "Login" }] });
    try { await faceSession.logout(); }
    catch { /* Local session is already deleted; offline server session expires normally. */ }
  }


  if (restoringSession) return <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#244B47" }}><ActivityIndicator color="#DEF9C4" /><Text style={{ color: "white", padding: 16 }}>{t("navigation.checkingSavedLogin")}</Text></View>;

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
          headerTintColor: theme.dark,
          headerStyle: { backgroundColor: theme.light },
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

            title: t("navigation.botanistDashboard"),

            headerTintColor: theme.dark,

            headerStyle: {
              backgroundColor: theme.light,
            },
          }}
        />

        <RootStack.Screen
          name="BotanistSubmissions"
          component={BotanistSubmissionsScreen}
          options={{ headerShown: true, title: t("submissions.title"), headerTintColor: theme.dark, headerStyle: { backgroundColor: theme.light } }}
        />

        <RootStack.Screen name="BotanistMyDrafts" component={BotanistMyDraftsScreen}
          options={{ headerShown: true, title: t("botanistDrafts.title"), headerTintColor: theme.dark, headerStyle: { backgroundColor: theme.light } }} />

        <RootStack.Screen
          name="BotanistCorrectionRequests"
          component={BotanistCorrectionRequestsScreen}
          options={{ headerShown: true, title: t("botanistDashboard.correctionRequests"), headerTintColor: theme.dark, headerStyle: { backgroundColor: theme.light } }}
        />

        
        <RootStack.Screen
          name="BotanistPlantDetail"
          component={BotanistPlantDetailScreen}
          options={({ route, navigation }) => centeredDetailHeader({
            route,
            navigation,
            title: t("navigation.plantDetails"),
          })}
        />

        <RootStack.Screen name="BotanistSpeciesRequestDetail" component={BotanistSpeciesRequestDetailScreen}
          options={({ route, navigation }) => centeredDetailHeader({
            route,
            navigation,
            title: t("submissions.requestDetails"),
          })} />

        <RootStack.Screen name="EditSpeciesRequest" component={EditSpeciesRequestScreen}
          options={{ headerShown: true, title: t("recordEdits.editSpecies"), headerTintColor: theme.dark, headerStyle: { backgroundColor: theme.light }, headerBackButtonMenuEnabled: false }} />

        <RootStack.Screen name="RecordChangeReview" component={RecordChangeReviewScreen}
          options={{ headerShown: true, title: t("recordEdits.reviewTitle"), headerTintColor: theme.dark, headerStyle: { backgroundColor: theme.light } }} />
        <RootStack.Screen name="RecordVersionHistory" component={RecordVersionHistoryScreen}
          options={{ headerShown: false, title: t("recordEdits.versionHistory"), headerTintColor: theme.dark, headerStyle: { backgroundColor: theme.light } }} />

        <RootStack.Screen
          name="BotanistNotifications"
          options={{ headerShown: true, title: t("navigation.notifications"), headerTintColor: theme.dark, headerStyle: { backgroundColor: theme.light } }}
        >
          {(props) => <BotanistNotificationsScreen {...props} user={user} />}
        </RootStack.Screen>

        <RootStack.Screen
          name="NotificationObservation"
          options={{ headerShown: true, title: t("navigation.observationDetails"), headerTintColor: theme.dark, headerStyle: { backgroundColor: theme.light } }}
        >
          {(props) => <NotificationObservationScreen {...props} user={user} />}
        </RootStack.Screen>

        <RootStack.Screen
          name="AddObservation"
          component={FieldCollectionScreen}
          options={{ headerShown: true, title: t("navigation.addNewObservation"), headerTintColor: theme.dark, headerStyle: { backgroundColor: theme.light }, headerBackButtonMenuEnabled: false }}
        />



        {/* ================================================
            ADD PLANT
        ================================================= */}

        <RootStack.Screen name="AddSpeciesRequest" component={AddSpeciesRequestScreen}
          options={{ headerShown: true, title: t("speciesRequestForm.title"), headerTintColor: theme.dark, headerStyle: { backgroundColor: theme.light }, headerBackButtonMenuEnabled: false }} />

        <RootStack.Screen
          name="AddPlant"
          component={AddPlantScreen}

          options={{
            headerShown: true,

            title: t("navigation.addPlant"),

            headerTintColor: theme.dark,

            headerStyle: {
              backgroundColor: theme.light,
            },
            headerBackButtonMenuEnabled: false,
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

            title: t("navigation.editPlant"),

            headerTintColor: theme.dark,

            headerStyle: {
              backgroundColor: theme.light,
            },
            headerBackButtonMenuEnabled: false,
          }}
        />

        <RootStack.Screen
          name="FieldCollection"
          component={FieldCollectionScreen}
          options={{
            headerShown: true,
            title: t("navigation.fieldCollection"),
            headerTintColor: theme.dark,
            headerStyle: { backgroundColor: theme.light },
            headerBackButtonMenuEnabled: false,
          }}
        />

        <RootStack.Screen
          name="FieldCollectionPlant"
          component={FieldCollectionScreen}
          options={{
            headerShown: true,
            title: t("navigation.registerPlant"),
            headerTintColor: theme.dark,
            headerStyle: { backgroundColor: theme.light },
            headerBackButtonMenuEnabled: false,
          }}
        />

        <RootStack.Screen
          name="FieldCollectionEdit"
          component={FieldCollectionScreen}
          options={{
            headerShown: true,
            title: t("navigation.correctObservation"),
            headerTintColor: theme.dark,
            headerStyle: { backgroundColor: theme.light },
            headerBackButtonMenuEnabled: false,
          }}
        />

        <RootStack.Screen
          name="PersistentKnowledge"
          options={{ headerShown: true, title: t("navigation.plantKnowledge") }}
        >
          {(props) => <PersistentKnowledgeScreen {...props} user={user} />}
        </RootStack.Screen>


        <RootStack.Screen
          name="KnowledgeMap"
          options={{ headerShown: true, title: t("navigation.knowledgeMap") }}
        >
          {(props) => <PersistentKnowledgeScreen {...props} user={user} />}
        </RootStack.Screen>

        <RootStack.Screen
          name="PlantQRCode"
          component={PlantQRCodeScreen}
          options={{
            headerShown: true,
            title: t("plantQRCode.pageTitle"),
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
