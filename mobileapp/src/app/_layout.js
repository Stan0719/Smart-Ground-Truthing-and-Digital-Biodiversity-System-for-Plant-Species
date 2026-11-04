import React from 'react';
import { Stack } from 'expo-router';
import LocalizationProvider from '../../translations/LocalizationProvider';
export default function Layout() {
  return <LocalizationProvider><Stack screenOptions={{ headerShown: false }} /></LocalizationProvider>;
}
