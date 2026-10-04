import AsyncStorage from "@react-native-async-storage/async-storage";

export const VISITOR_ACCOUNTS_KEY = "@niah_biodiversity/visitor_accounts";

export async function getVisitorAccounts() {
  const storedVisitors = await AsyncStorage.getItem(VISITOR_ACCOUNTS_KEY);

  if (!storedVisitors) {
    return [];
  }

  try {
    const visitors = JSON.parse(storedVisitors);
    return Array.isArray(visitors) ? visitors : [];
  } catch {
    return [];
  }
}

export function getNextVisitorId(visitors) {
  const usedNumbers = new Set(
    visitors
      .map((visitor) => /^VIS(\d+)$/.exec(visitor.id)?.[1])
      .filter(Boolean)
      .map(Number)
  );

  let nextNumber = 1;

  while (usedNumbers.has(nextNumber)) {
    nextNumber += 1;
  }

  return `VIS${String(nextNumber).padStart(3, "0")}`;
}

export async function saveVisitorAccount(visitor) {
  const visitors = await getVisitorAccounts();
  await AsyncStorage.setItem(
    VISITOR_ACCOUNTS_KEY,
    JSON.stringify([...visitors, visitor])
  );
}
