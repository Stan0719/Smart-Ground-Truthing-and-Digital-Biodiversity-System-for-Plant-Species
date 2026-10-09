import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import { NavigationIndependentTree } from 'expo-router/react-navigation';
import App from '../../App';

// Preserve the existing screens inside an independent navigation tree.
export default function Index() {
  const { recoveryHome } = useLocalSearchParams();
  return <NavigationIndependentTree><App homeRequest={recoveryHome} /></NavigationIndependentTree>;
}
