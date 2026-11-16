import { StyleSheet } from "react-native";

// Shared secondary navigation action for Login and Register.
export const authNavigationStyles = StyleSheet.create({
  button: {
    width: "100%",
    minHeight: 50,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: "#50B498",
    borderRadius: 12,
    backgroundColor: "rgba(80, 180, 152, 0.10)",
    alignItems: "center",
    justifyContent: "center",
  },
  text: {
    color: "#DEF9C4",
    fontSize: 16,
    fontWeight: "700",
    textAlign: "center",
  },
});
