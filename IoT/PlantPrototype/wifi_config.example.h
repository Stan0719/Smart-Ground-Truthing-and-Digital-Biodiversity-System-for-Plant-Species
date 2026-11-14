#pragma once

// Copy to wifi_config.h, fill in locally, and keep that file private.
#define PLANT_TRANSPORT_WIFI 1
#define WIFI_SSID "YOUR_WIFI_NAME"
#define WIFI_PASSWORD "YOUR_WIFI_PASSWORD"
#define LAPTOP_HOST "192.168.1.10"
#define LAPTOP_PORT 8443
#define INGRESS_TOKEN "REPLACE_WITH_RANDOM_TOKEN"
static const char LAPTOP_CA_CERT[] = R"CERT(-----BEGIN CERTIFICATE-----
PASTE_LAPTOP_CA_CERTIFICATE_HERE
-----END CERTIFICATE-----
)CERT";
