#include <Arduino.h>
#include <Wire.h>
#include <math.h>
#include <DHT.h>
#include <Adafruit_MPU6050.h>
#include <Adafruit_Sensor.h>

// ==================== PIN CONFIGURATION ====================

#define LED_PIN 5
#define DHT_PIN 4
#define DHT_TYPE DHT11

#define SOIL_PIN 35
#define RAIN_PIN 34
#define SOUND_PIN 32

// ==================== SENSOR OBJECTS ====================

DHT dht(DHT_PIN, DHT_TYPE);
Adafruit_MPU6050 mpu;

bool mpuReady = false;

// ==================== SAMPLING INTERVALS ====================

const unsigned long SOIL_SAMPLE_INTERVAL = 30000;
const unsigned long RAIN_SAMPLE_INTERVAL = 2000;
const unsigned long DHT_SAMPLE_INTERVAL = 600000;
const unsigned long SOUND_SAMPLE_INTERVAL = 2000;

unsigned long lastSoilSample = 0;
unsigned long lastRainSample = 0;
unsigned long lastDHTSample = 0;
unsigned long lastSoundSample = 0;

// ==================== SENSOR READINGS ====================

int soilValue = 0;
int rainValue = 0;
int soundValue = 0;

float temperature = NAN;
float humidity = NAN;

bool soilHasReading = false;
bool rainHasReading = false;
bool soundHasReading = false;
bool dhtHasReading = false;

// ==================== SENSOR THRESHOLDS ====================

const int SOIL_DRY_THRESHOLD = 2700;
const int SOIL_WET_THRESHOLD = 2300;

const int RAIN_DRY_THRESHOLD = 3000;
const int RAIN_WET_THRESHOLD = 2200;

// ==================== MPU6050 MOVEMENT DETECTION ====================

float baseX = 0;
float baseY = 0;
float baseZ = 0;

bool baselineSet = false;
bool movementActive = false;

unsigned long lastMovementTime = 0;
unsigned long movementCount = 0;

// Movement detection thresholds
const float ACCEL_MOVEMENT_THRESHOLD = 1.8;  // m/s^2
const float GYRO_MOVEMENT_THRESHOLD = 20.0;   // degrees/second

// Time without movement required to end an event
const unsigned long QUIET_TIME = 1500;

// ==================== DASHBOARD ====================

unsigned long lastDashboardRefresh = 0;
const unsigned long DASHBOARD_INTERVAL = 500;

// ==================== SENSOR CLASSIFICATIONS ====================

const char* getSoilCondition() {
    if (!soilHasReading) return "Waiting...";
    if (soilValue > SOIL_DRY_THRESHOLD) return "Dry";
    if (soilValue < SOIL_WET_THRESHOLD) return "Wet";

    return "Slightly moist";
}

const char* getRainCondition() {
    if (!rainHasReading) return "Waiting...";
    if (rainValue > RAIN_DRY_THRESHOLD) return "Dry";
    if (rainValue < RAIN_WET_THRESHOLD) return "Wet surface";

    return "Water present";
}

// ==================== DASHBOARD DISPLAY ====================

void displayDashboard() {
    Serial.print("\033[H\033[2J");

    Serial.println("==============================================");
    Serial.println("       BIODIVERSITY SENSOR MONITOR");
    Serial.println("==============================================");

    Serial.println();

    // SOIL MOISTURE
    Serial.println("[ SOIL MOISTURE ]");

    if (soilHasReading) {
        Serial.printf("Reading      : %d\n", soilValue);
        Serial.printf("Condition    : %s\n", getSoilCondition());
    } else {
        Serial.println("Reading      : Waiting for first sample");
    }

    Serial.println();

    // RAINDROP SENSOR
    Serial.println("[ RAINDROP SENSOR ]");

    if (rainHasReading) {
        Serial.printf("Reading      : %d\n", rainValue);
        Serial.printf("Condition    : %s\n", getRainCondition());
    } else {
        Serial.println("Reading      : Waiting for first sample");
    }

    Serial.println();

    // DHT11
    Serial.println("[ DHT11 ]");

    if (dhtHasReading) {
        Serial.printf("Temperature  : %.1f C\n", temperature);
        Serial.printf("Humidity     : %.1f %%\n", humidity);
    } else {
        Serial.println("Temperature  : Waiting for first sample");
        Serial.println("Humidity     : Waiting for first sample");
    }

    Serial.println();

    // MPU6050
    Serial.println("[ MPU6050 ]");

    Serial.printf(
        "Status       : %s\n",
        mpuReady ? "Connected" : "Not detected"
    );

    Serial.printf(
        "Movement     : %s\n",
        movementActive ? "DETECTED" : "No movement"
    );

    Serial.printf("Movement No. : %lu\n", movementCount);

    Serial.printf(
        "LED Status   : %s\n",
        digitalRead(LED_PIN) == HIGH ? "ON" : "OFF"
    );

    Serial.println();

    // SOUND SENSOR
    Serial.println("[ SOUND SENSOR ]");

    if (soundHasReading) {
        Serial.printf("Reading      : %d\n", soundValue);
    } else {
        Serial.println("Reading      : Waiting for first sample");
    }

    Serial.println();

    // SAMPLING INTERVALS
    Serial.println("----------------------------------------------");
    Serial.println("Sampling intervals:");
    Serial.println("Soil: 30 seconds | Rain: 2 seconds");
    Serial.println("DHT11: 10 minutes | Sound: 2 seconds");
    Serial.println("----------------------------------------------");
}

// ==================== SENSOR SAMPLING ====================

void sampleSoilMoisture() {
    soilValue = analogRead(SOIL_PIN);
    soilHasReading = true;
}

void sampleRainSensor() {
    rainValue = analogRead(RAIN_PIN);
    rainHasReading = true;
}

void sampleDHT11() {
    float newTemperature = dht.readTemperature();
    float newHumidity = dht.readHumidity();

    if (!isnan(newTemperature) && !isnan(newHumidity)) {
        temperature = newTemperature;
        humidity = newHumidity;
        dhtHasReading = true;
    }
}

void sampleSoundSensor() {
    soundValue = analogRead(SOUND_PIN);
    soundHasReading = true;
}

// ==================== MOVEMENT DETECTION ====================

void monitorMovement() {
    if (!mpuReady || !baselineSet) {
        return;
    }

    sensors_event_t a, g, temp;
    mpu.getEvent(&a, &g, &temp);

    // Calculate total acceleration magnitude.
    // This is less sensitive to the sensor's resting orientation.
    float accelerationMagnitude = sqrt(
        a.acceleration.x * a.acceleration.x +
        a.acceleration.y * a.acceleration.y +
        a.acceleration.z * a.acceleration.z
    );

    // At rest, acceleration magnitude should be approximately 9.81 m/s^2.
    float accelerationChange = fabs(accelerationMagnitude - 9.81);

    // Calculate total rotation rate.
    // Adafruit reports gyroscope values in radians per second.
    float rotationRate = sqrt(
        g.gyro.x * g.gyro.x +
        g.gyro.y * g.gyro.y +
        g.gyro.z * g.gyro.z
    ) * 180.0 / PI;

    // Detect significant acceleration or rotation.
    bool significantMovement =
        accelerationChange > ACCEL_MOVEMENT_THRESHOLD ||
        rotationRate > GYRO_MOVEMENT_THRESHOLD;

    unsigned long now = millis();

    // Start a new event when movement is detected.
    if (significantMovement) {
        if (!movementActive) {
            movementActive = true;
            movementCount++;

            digitalWrite(LED_PIN, HIGH);
        }

        // Reset the timer while movement continues.
        lastMovementTime = now;
    }

    // End the event after readings remain below the thresholds
    // for the complete quiet period.
    if (movementActive &&
        !significantMovement &&
        now - lastMovementTime >= QUIET_TIME) {

        movementActive = false;

        digitalWrite(LED_PIN, LOW);
    }
}

// ==================== SETUP ====================

void setup() {
    Serial.begin(115200);
    delay(1000);

    pinMode(LED_PIN, OUTPUT);
    digitalWrite(LED_PIN, LOW);

    pinMode(SOIL_PIN, INPUT);
    pinMode(RAIN_PIN, INPUT);
    pinMode(SOUND_PIN, INPUT);

    dht.begin();

    // ESP32 I2C pins
    Wire.begin(21, 22);

    // Initialize MPU6050
    if (mpu.begin()) {
        mpuReady = true;

        mpu.setAccelerometerRange(MPU6050_RANGE_4_G);
        mpu.setGyroRange(MPU6050_RANGE_500_DEG);
        mpu.setFilterBandwidth(MPU6050_BAND_21_HZ);

        Serial.println("Keep the box still for calibration...");

        delay(2000);

        const int samples = 100;

        float sumX = 0;
        float sumY = 0;
        float sumZ = 0;

        // Calibrate while the box remains stationary.
        for (int i = 0; i < samples; i++) {
            sensors_event_t a, g, temp;

            mpu.getEvent(&a, &g, &temp);

            sumX += a.acceleration.x;
            sumY += a.acceleration.y;
            sumZ += a.acceleration.z;

            delay(10);
        }

        baseX = sumX / samples;
        baseY = sumY / samples;
        baseZ = sumZ / samples;

        baselineSet = true;
    } else {
        Serial.println("ERROR: MPU6050 not detected!");
    }

    // Take initial readings.
    sampleSoilMoisture();
    sampleRainSensor();
    sampleDHT11();
    sampleSoundSensor();

    unsigned long now = millis();

    lastSoilSample = now;
    lastRainSample = now;
    lastDHTSample = now;
    lastSoundSample = now;

    lastDashboardRefresh = now;
}

// ==================== MAIN LOOP ====================

void loop() {
    unsigned long now = millis();

    // Continuously monitor movement.
    monitorMovement();

    // Soil moisture: every 30 seconds.
    if (now - lastSoilSample >= SOIL_SAMPLE_INTERVAL) {
        lastSoilSample = now;
        sampleSoilMoisture();
    }

    // Raindrop sensor: every 2 seconds.
    if (now - lastRainSample >= RAIN_SAMPLE_INTERVAL) {
        lastRainSample = now;
        sampleRainSensor();
    }

    // DHT11: every 10 minutes.
    if (now - lastDHTSample >= DHT_SAMPLE_INTERVAL) {
        lastDHTSample = now;
        sampleDHT11();
    }

    // Sound sensor: every 2 seconds.
    if (now - lastSoundSample >= SOUND_SAMPLE_INTERVAL) {
        lastSoundSample = now;
        sampleSoundSensor();
    }

    // Refresh the dashboard twice per second.
    if (now - lastDashboardRefresh >= DASHBOARD_INTERVAL) {
        lastDashboardRefresh = now;
        displayDashboard();
    }
}