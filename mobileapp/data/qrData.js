// qrData.js

export const qrCodes = [];

// Generate new QR codes
export function generateQRCodes(
  count,
  botanistName = "Unknown"
) {
  const newCodes = [];

  let nextNumber = 1;

  if (qrCodes.length > 0) {
    const numbers = qrCodes
      .map((qr) => {
        const number = parseInt(
          qr.id.replace("NIAH-QR-", ""),
          10
        );

        return isNaN(number) ? 0 : number;
      })
      .filter((number) => number > 0);

    if (numbers.length > 0) {
      nextNumber =
        Math.max(...numbers) + 1;
    }
  }

  for (let i = 0; i < count; i++) {
    const qrNumber = String(
      nextNumber + i
    ).padStart(3, "0");

    const newQr = {
      id: `NIAH-QR-${qrNumber}`,

      value: `NIAH-QR-${qrNumber}`,

      status: "AVAILABLE",

      plantId: null,

      botanist: botanistName,

      createdAt:
        new Date().toISOString(),

      assignedAt: null,
    };

    qrCodes.push(newQr);

    newCodes.push(newQr);
  }

  return newCodes;
}


// Assign QR code to a plant
export function assignQRCode(
  qrId,
  plantId
) {
  const qr = qrCodes.find(
    (item) => item.id === qrId
  );

  if (!qr) {
    return false;
  }

  if (qr.status !== "AVAILABLE") {
    return false;
  }

  qr.status = "PENDING_APPROVAL";

  qr.plantId = plantId;

  qr.assignedAt =
    new Date().toISOString();

  return true;
}


// Approve QR code
export function approveQRCode(
  qrId
) {
  const qr = qrCodes.find(
    (item) => item.id === qrId
  );

  if (!qr) {
    return false;
  }

  qr.status = "APPROVED";

  return true;
}


// Reject QR code
export function rejectQRCode(
  qrId
) {
  const qr = qrCodes.find(
    (item) => item.id === qrId
  );

  if (!qr) {
    return false;
  }

  qr.status = "REJECTED";

  return true;
}

export function deleteQRCode(qrId) {
  const index = qrCodes.findIndex(
    (qr) => qr.id === qrId
  );

  if (index === -1) {
    return false;
  }

  if (qrCodes[index].status !== "AVAILABLE") {
    return false;
  }

  qrCodes.splice(index, 1);

  return true;
}