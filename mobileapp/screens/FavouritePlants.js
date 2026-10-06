import React from "react";

import {
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  Image,
} from "react-native";

import { Ionicons } from "@expo/vector-icons";

import { plants } from "../data/mockData";

export default function FavouritePlantsScreen({
  navigation,
}) {

  // Temporary frontend data
  // Later this will come from the logged-in visitor's account.
  const favouriteIds = [
    "NIAH-PLANT-0001",
    "NIAH-PLANT-0003",
  ];

  const favouritePlants = plants.filter((plant) =>
    favouriteIds.includes(plant.id)
  );


  return (
    <SafeAreaView style={styles.container}>

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >

        {/* Header */}
        <View style={styles.header}>

          <TouchableOpacity
            style={styles.backButton}
            onPress={() => navigation.goBack()}
          >
            <Ionicons
              name="arrow-back"
              size={24}
              color="#468585"
            />
          </TouchableOpacity>

          <Text style={styles.title}>
            Favourite Plants
          </Text>

        </View>


        {/* Favourite Plants */}
        {favouritePlants.length === 0 ? (

          <View style={styles.emptyContainer}>

            <Ionicons
              name="star-outline"
              size={60}
              color="#9CDBA6"
            />

            <Text style={styles.emptyTitle}>
              No Favourite Plants
            </Text>

            <Text style={styles.emptyText}>
              Plants you favourite will appear here.
            </Text>

          </View>

        ) : (

          <View>

            {favouritePlants.map((plant) => (

              <TouchableOpacity
                key={plant.id}
                style={styles.plantCard}
                onPress={() =>
                  navigation.navigate("PlantDetails", {
                    plant,
                  })
                }
              >

                {/* Plant Image */}
                <View style={styles.imageContainer}>

                  {plant.photo ? (

                    <Image
                      source={{ uri: plant.photo }}
                      style={styles.plantImage}
                    />

                  ) : (

                    <Ionicons
                      name="leaf"
                      size={30}
                      color="#468585"
                    />

                  )}

                </View>


                {/* Plant Information */}
                <View style={styles.plantInfo}>

                  <Text style={styles.plantName}>
                    {plant.name}
                  </Text>

                  <Text style={styles.scientificName}>
                    {plant.scientificName}
                  </Text>

                  <Text style={styles.category}>
                    {plant.category}
                  </Text>

                </View>


                {/* Favourite Icon */}
                <Ionicons
                  name="star"
                  size={23}
                  color="#50B498"
                />

              </TouchableOpacity>

            ))}

          </View>

        )}

      </ScrollView>

    </SafeAreaView>
  );
}


const styles = StyleSheet.create({

  container: {
    flex: 1,
    backgroundColor: "#F8FFF5",
  },

  content: {
    padding: 20,
    paddingBottom: 40,
  },

  header: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 24,
  },

  backButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: "#DEF9C4",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },

  title: {
    fontSize: 24,
    fontWeight: "700",
    color: "#468585",
  },

  plantCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 15,
    marginBottom: 12,

    elevation: 2,
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 5,
    shadowOffset: {
      width: 0,
      height: 2,
    },
  },

  imageContainer: {
    width: 65,
    height: 65,
    borderRadius: 14,
    backgroundColor: "#DEF9C4",

    justifyContent: "center",
    alignItems: "center",

    marginRight: 14,

    overflow: "hidden",
  },

  plantImage: {
    width: "100%",
    height: "100%",
  },

  plantInfo: {
    flex: 1,
  },

  plantName: {
    fontSize: 16,
    fontWeight: "700",
    color: "#315E59",
    marginBottom: 4,
  },

  scientificName: {
    fontSize: 13,
    fontStyle: "italic",
    color: "#7A918C",
    marginBottom: 5,
  },

  category: {
    fontSize: 12,
    color: "#50B498",
    fontWeight: "600",
  },

  emptyContainer: {
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 100,
    paddingHorizontal: 30,
  },

  emptyTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: "#468585",
    marginTop: 16,
    marginBottom: 8,
  },

  emptyText: {
    fontSize: 14,
    color: "#7A918C",
    textAlign: "center",
  },

});