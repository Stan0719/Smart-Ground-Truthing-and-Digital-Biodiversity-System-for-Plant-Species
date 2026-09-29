import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  FlatList,
  StyleSheet,
} from "react-native";

import { plants } from "../data/mockData";
import PlantCard from "../components/PlantCard";

export default function PlantsScreen({ navigation }) {
  const [search, setSearch] = useState("");

  const filteredPlants = plants.filter((plant) => {
    const keyword = search.toLowerCase();

    return (
      plant.scientificName.toLowerCase().includes(keyword) ||
      plant.commonName.toLowerCase().includes(keyword)
    );
  });

  return (
    <View style={styles.container}>
      <Text style={styles.title}>
        Plant Information
      </Text>

      <Text style={styles.subtitle}>
        Explore plant species documented in Niah National Park
      </Text>

      <TextInput
        style={styles.search}
        placeholder="Search plant..."
        value={search}
        onChangeText={setSearch}
      />

      <FlatList
        data={filteredPlants}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <PlantCard
            plant={item}
            onPress={() =>
              navigation.navigate("PlantDetails", {
                plant: item,
              })
            }
          />
        )}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingBottom: 30,
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F7FAF5",
    padding: 20,
  },

  title: {
    fontSize: 27,
    fontWeight: "700",
    color: "#234D20",
    marginTop: 10,
  },

  subtitle: {
    color: "#687568",
    marginTop: 5,
    marginBottom: 15,
  },

  search: {
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    padding: 14,
    fontSize: 15,
    marginBottom: 15,
  },
});