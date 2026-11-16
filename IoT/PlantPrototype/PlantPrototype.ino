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

#define MPU6050_ADDRESS 0x68

// ==================== SENSOR OBJECTS ====================

DHT dht(DHT_PIN, DHT_TYPE);
Adafruit_MPU6050 mpu;

bool mpuReady = false;

// ==================== SAMPLING INTERVALS ====================

const unsigned long SOIL_SAMPLE_INTERVAL = 1000;
const unsigned long RAIN_SAMPLE_INTERVAL = 1000;
const unsigned long DHT_SAMPLE_INTERVAL = 1000;

unsigned long lastSoilSample = 0;
unsigned long lastRainSample = 0;
unsigned long lastDHTSample = 0;

// ==================== DEVICE HEALTH SETTINGS ====================

const unsigned long ANALOG_STALE_TIMEOUT = 3000;
const unsigned long DHT_STALE_TIMEOUT = 5000;

const unsigned int DHT_FAILURE_WARNING_COUNT = 3;

const unsigned long MPU_HEALTH_CHECK_INTERVAL = 2000;

unsigned long lastMPUHealthCheck = 0;

// ==================== SENSOR READINGS ====================

int soilValue = 0;
int rainValue = 0;

float temperature = NAN;
float humidity = NAN;

bool soilHasReading = false;
bool rainHasReading = false;
bool dhtHasReading = false;

// Last successful reading timestamps.

unsigned long soilLastReadingAt = 0;
unsigned long rainLastReadingAt = 0;
unsigned long dhtLastValidReadingAt = 0;

// Consecutive DHT11 failures.

unsigned int dhtConsecutiveFailures = 0;

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

// Movement detection thresholds.

const float ACCEL_MOVEMENT_THRESHOLD = 1.8;
const float GYRO_MOVEMENT_THRESHOLD = 20.0;

// Time without movement required to end an event.

const unsigned long QUIET_TIME = 1500;

// ==================== DASHBOARD SETTINGS ====================

// Dashboard refresh every 2 seconds.
// Sensor sampling intervals remain unchanged.

unsigned long lastDashboardRefresh = 0;
const unsigned long DASHBOARD_INTERVAL = 2000;

// ==================== SENSOR CLASSIFICATIONS ====================

const char* getSoilCondition() {

    if (!soilHasReading) {
        return "Waiting...";
    }

    if (soilValue > SOIL_DRY_THRESHOLD) {
        return "Dry";
    }

    if (soilValue < SOIL_WET_THRESHOLD) {
        return "Wet";
    }

    return "Slightly moist";
}

const char* getRainCondition() {

    if (!rainHasReading) {
        return "Waiting...";
    }

    if (rainValue > RAIN_DRY_THRESHOLD) {
        return "Dry";
    }

    if (rainValue < RAIN_WET_THRESHOLD) {
        return "Wet surface";
    }

    return "Water present";
}

// ==================== DHT11 HEALTH STATUS ====================

const char* getDHTHealthStatus(unsigned long now) {

    if (!dhtHasReading) {

        if (dhtConsecutiveFailures >=
            DHT_FAILURE_WARNING_COUNT) {

            return "WARNING - No valid readings";
        }

        return "Waiting for valid reading";
    }

    // Check whether the last valid reading is too old.

    if (now - dhtLastValidReadingAt >
        DHT_STALE_TIMEOUT) {

        return "ERROR - Reading is stale";
    }

    // Warn after repeated failed readings.

    if (dhtConsecutiveFailures >=
        DHT_FAILURE_WARNING_COUNT) {

        return "WARNING - Repeated failures";
    }

    return "Operational";
}

// ==================== ANALOG SENSOR HEALTH ====================

const char* getAnalogHealthStatus(
    bool hasReading,
    unsigned long lastReadingAt,
    unsigned long now
) {

    if (!hasReading) {
        return "Waiting for first sample";
    }

    if (now - lastReadingAt >
        ANALOG_STALE_TIMEOUT) {

        return "WARNING - No recent sample";
    }

    // Confirms that the ESP32 is sampling the analog input.
    // It cannot verify the physical sensor connection without
    // additional hardware or a sensor-specific diagnostic.

    return "Sampling active";
}

// ==================== OVERALL SYSTEM HEALTH ====================

const char* getSystemHealth(unsigned long now) {

    bool dhtProblem =
        dhtConsecutiveFailures >=
            DHT_FAILURE_WARNING_COUNT
        ||
        (
            dhtHasReading &&
            now - dhtLastValidReadingAt >
                DHT_STALE_TIMEOUT
        );

    bool soilProblem =
        !soilHasReading ||
        now - soilLastReadingAt >
            ANALOG_STALE_TIMEOUT;

    bool rainProblem =
        !rainHasReading ||
        now - rainLastReadingAt >
            ANALOG_STALE_TIMEOUT;

    // Report a warning if the MPU6050 is unavailable
    // or a sensor-reading problem has been detected.

    if (!mpuReady ||
        dhtProblem ||
        soilProblem ||
        rainProblem) {

        return "WARNING";
    }

    // Check that initial environmental readings exist.

    if (!dhtHasReading ||
        !soilHasReading ||
        !rainHasReading) {

        return "INITIALIZING";
    }

    // The analog inputs are being sampled, but their physical
    // connections cannot be verified from analogRead() alone.
    return "BASIC CHECKS OK";
}

// ==================== MPU6050 INITIALIZATION ====================

bool initializeMPU() {

    if (!mpu.begin()) {
        return false;
    }

    mpu.setAccelerometerRange(
        MPU6050_RANGE_4_G
    );

    mpu.setGyroRange(
        MPU6050_RANGE_500_DEG
    );

    mpu.setFilterBandwidth(
        MPU6050_BAND_21_HZ
    );

    return true;
}

// ==================== MPU6050 CALIBRATION ====================

void calibrateMPU(
    int samples,
    unsigned long sampleDelay
) {

    float sumX = 0;
    float sumY = 0;
    float sumZ = 0;

    for (int i = 0; i < samples; i++) {

        sensors_event_t a, g, temp;

        mpu.getEvent(&a, &g, &temp);

        sumX += a.acceleration.x;
        sumY += a.acceleration.y;
        sumZ += a.acceleration.z;

        if (sampleDelay > 0) {
            delay(sampleDelay);
        }
    }

    baseX = sumX / samples;
    baseY = sumY / samples;
    baseZ = sumZ / samples;

    baselineSet = true;
}

// ==================== MPU6050 CONNECTION MONITORING ====================

bool isMPUResponding() {

    Wire.beginTransmission(MPU6050_ADDRESS);

    return Wire.endTransmission() == 0;
}

void updateMPUHealth() {

    unsigned long now = millis();

    // Perform the health check at the configured interval.

    if (now - lastMPUHealthCheck <
        MPU_HEALTH_CHECK_INTERVAL) {

        return;
    }

    lastMPUHealthCheck = now;

    bool sensorPresent = isMPUResponding();

    // If the sensor stops responding, disable movement detection.

    if (!sensorPresent) {

        if (mpuReady) {

            mpuReady = false;
            baselineSet = false;
            movementActive = false;

            digitalWrite(LED_PIN, LOW);
        }

        return;
    }

    // If the sensor becomes available again, reinitialize it.

    if (!mpuReady) {

        if (initializeMPU()) {

            // Keep the device stationary during recalibration.

            calibrateMPU(30, 10);

            mpuReady = true;

        } else {

            mpuReady = false;
            baselineSet = false;
        }
    }
}

// ==================== SENSOR SAMPLING ====================

void sampleSoilMoisture() {

    soilValue = analogRead(SOIL_PIN);

    soilHasReading = true;

    soilLastReadingAt = millis();
}

void sampleRainSensor() {

    rainValue = analogRead(RAIN_PIN);

    rainHasReading = true;

    rainLastReadingAt = millis();
}

void sampleDHT11() {

    float newTemperature = dht.readTemperature();
    float newHumidity = dht.readHumidity();

    unsigned long now = millis();

    if (!isnan(newTemperature) &&
        !isnan(newHumidity)) {

        temperature = newTemperature;
        humidity = newHumidity;

        dhtHasReading = true;

        dhtLastValidReadingAt = now;

        // Reset the failure counter after a valid reading.

        dhtConsecutiveFailures = 0;

    } else {

        // Preserve the last valid readings.
        // Do not replace them with invalid values.

        if (dhtConsecutiveFailures < 1000) {
            dhtConsecutiveFailures++;
        }
    }
}

// ==================== MOVEMENT DETECTION ====================

void monitorMovement() {

    if (!mpuReady || !baselineSet) {
        return;
    }

    sensors_event_t a, g, temp;

    mpu.getEvent(&a, &g, &temp);

    // Calculate total acceleration magnitude.

    float accelerationMagnitude = sqrt(
        a.acceleration.x * a.acceleration.x +
        a.acceleration.y * a.acceleration.y +
        a.acceleration.z * a.acceleration.z
    );

    // At rest, acceleration magnitude is approximately 9.81 m/s^2.

    float accelerationChange =
        fabs(accelerationMagnitude - 9.81);

    // Calculate total rotational speed.
    // Adafruit reports gyroscope readings in radians per second.

    float rotationRate = sqrt(
        g.gyro.x * g.gyro.x +
        g.gyro.y * g.gyro.y +
        g.gyro.z * g.gyro.z
    ) * 180.0 / PI;

    // Movement is detected if either threshold is exceeded.

    bool significantMovement =
        accelerationChange > ACCEL_MOVEMENT_THRESHOLD ||
        rotationRate > GYRO_MOVEMENT_THRESHOLD;

    unsigned long now = millis();

    // Start a new movement event.

    if (significantMovement) {

        if (!movementActive) {

            movementActive = true;

            movementCount++;

            digitalWrite(LED_PIN, HIGH);
        }

        // Reset the quiet timer while movement continues.

        lastMovementTime = now;
    }

    // End the event after the configured quiet period.

    if (movementActive &&
        !significantMovement &&
        now - lastMovementTime >= QUIET_TIME) {

        movementActive = false;

        digitalWrite(LED_PIN, LOW);
    }
}

// ==================== DASHBOARD DISPLAY ====================

void displayDashboard() {

    unsigned long now = millis();

    // Clear the PuTTY terminal and return the cursor
    // to the top-left corner before drawing the dashboard.

    Serial.print("\033[2J\033[H");

    Serial.println("==================================================");
    Serial.println("          BIODIVERSITY SENSOR MONITOR");
    Serial.println("==================================================");

    // ==================== ENVIRONMENTAL MONITORING ====================

    Serial.println();
    Serial.println("[ ENVIRONMENTAL MONITORING ]");
    Serial.println("--------------------------------------------------");

    // Soil moisture

    if (soilHasReading) {

        Serial.printf(
            "%-22s : %d\r\n",
            "Soil Moisture",
            soilValue
        );

        Serial.printf(
            "%-22s : %s\r\n",
            "Soil Condition",
            getSoilCondition()
        );

    } else {

        Serial.println(
            "Soil Moisture         : Waiting for reading"
        );
    }

    // Raindrop sensor

    if (rainHasReading) {

        Serial.printf(
            "%-22s : %d\r\n",
            "Raindrop Sensor",
            rainValue
        );

        Serial.printf(
            "%-22s : %s\r\n",
            "Surface Condition",
            getRainCondition()
        );

    } else {

        Serial.println(
            "Raindrop Sensor       : Waiting for reading"
        );
    }

    // DHT11

    if (dhtHasReading) {

        Serial.printf(
            "%-22s : %.1f C\r\n",
            "Temperature",
            temperature
        );

        Serial.printf(
            "%-22s : %.1f %%\r\n",
            "Humidity",
            humidity
        );

    } else {

        Serial.println(
            "Temperature           : No valid reading"
        );

        Serial.println(
            "Humidity              : No valid reading"
        );
    }

    // ==================== MOVEMENT DETECTION ====================

    Serial.println();
    Serial.println("[ MOVEMENT DETECTION ]");
    Serial.println("--------------------------------------------------");

    Serial.printf(
        "%-22s : %s\r\n",
        "MPU6050",
        mpuReady ? "Connected" : "Not detected"
    );

    Serial.printf(
        "%-22s : %s\r\n",
        "Movement Status",
        movementActive ? "DETECTED" : "No movement"
    );

    Serial.printf(
        "%-22s : %lu\r\n",
        "Movement Count",
        movementCount
    );

    Serial.printf(
        "%-22s : %s\r\n",
        "LED Alert",
        digitalRead(LED_PIN) == HIGH ? "ON" : "OFF"
    );

    // ==================== DEVICE HEALTH ====================

    Serial.println();
    Serial.println("[ DEVICE HEALTH ]");
    Serial.println("--------------------------------------------------");

    Serial.printf(
        "%-22s : Running\r\n",
        "ESP32"
    );

    // DHT11 health status

    Serial.printf(
        "%-22s : %s\r\n",
        "DHT11 Status",
        getDHTHealthStatus(now)
    );

    if (dhtHasReading) {

        Serial.printf(
            "%-22s : %.1f seconds ago\r\n",
            "DHT11 Last Valid",
            (now - dhtLastValidReadingAt) / 1000.0
        );

    } else {

        Serial.printf(
            "%-22s : No valid reading\r\n",
            "DHT11 Last Valid"
        );
    }

    Serial.printf(
        "%-22s : %u consecutive\r\n",
        "DHT11 Failures",
        dhtConsecutiveFailures
    );

    // Soil moisture health

    Serial.printf(
        "%-22s : %s\r\n",
        "Soil Sampling",
        getAnalogHealthStatus(
            soilHasReading,
            soilLastReadingAt,
            now
        )
    );

    Serial.printf(
        "%-22s : Unverified (analog)\r\n",
        "Soil Connection"
    );

    if (soilHasReading) {

        Serial.printf(
            "%-22s : %.1f seconds ago\r\n",
            "Soil Last Sample",
            (now - soilLastReadingAt) / 1000.0
        );
    }

    // Raindrop sensor health

    Serial.printf(
        "%-22s : %s\r\n",
        "Rain Sampling",
        getAnalogHealthStatus(
            rainHasReading,
            rainLastReadingAt,
            now
        )
    );

    Serial.printf(
        "%-22s : Unverified (analog)\r\n",
        "Rain Connection"
    );

    if (rainHasReading) {

        Serial.printf(
            "%-22s : %.1f seconds ago\r\n",
            "Rain Last Sample",
            (now - rainLastReadingAt) / 1000.0
        );
    }

    // Overall system health

    Serial.printf(
        "%-22s : %s\r\n",
        "Overall System Health",
        getSystemHealth(now)
    );

    Serial.println(
        "Analog connections     : Not physically verified"
    );

    // Device uptime

    Serial.printf(
        "%-22s : %lu seconds\r\n",
        "Device Uptime",
        now / 1000UL
    );

    // ==================== SYSTEM CONFIGURATION ====================

    Serial.println();
    Serial.println("[ SYSTEM CONFIGURATION ]");
    Serial.println("--------------------------------------------------");

    Serial.printf(
        "%-22s : %lu ms\r\n",
        "Soil Sampling",
        SOIL_SAMPLE_INTERVAL
    );

    Serial.printf(
        "%-22s : %lu ms\r\n",
        "Rain Sampling",
        RAIN_SAMPLE_INTERVAL
    );

    Serial.printf(
        "%-22s : %lu ms\r\n",
        "DHT11 Sampling",
        DHT_SAMPLE_INTERVAL
    );

    Serial.println(
        "MPU6050 Sampling      : Continuous"
    );

    Serial.printf(
        "%-22s : %lu ms\r\n",
        "Dashboard Refresh",
        DASHBOARD_INTERVAL
    );

    Serial.println(
        "MPU Health Check      : Every 2000 ms"
    );

    Serial.println("==================================================");
}

// ==================== SETUP ====================

void setup() {

    Serial.begin(115200);

    delay(1000);

    pinMode(LED_PIN, OUTPUT);

    digitalWrite(LED_PIN, LOW);

    pinMode(SOIL_PIN, INPUT);
    pinMode(RAIN_PIN, INPUT);

    dht.begin();

    // ESP32 I2C pins: SDA = GPIO 21, SCL = GPIO 22.

    Wire.begin(21, 22);

    // Initialize the MPU6050.

    if (initializeMPU()) {

        mpuReady = true;

        Serial.println(
            "Keep the box still for calibration..."
        );

        delay(2000);

        calibrateMPU(100, 10);

    } else {

        mpuReady = false;
        baselineSet = false;

        Serial.println(
            "WARNING: MPU6050 not detected!"
        );
    }

    // Take initial environmental sensor readings.

    sampleSoilMoisture();
    sampleRainSensor();
    sampleDHT11();

    unsigned long now = millis();

    lastSoilSample = now;
    lastRainSample = now;
    lastDHTSample = now;

    lastDashboardRefresh = now;
    lastMPUHealthCheck = now;
}

// ==================== MAIN LOOP ====================

void loop() {

    unsigned long now = millis();

    // Check the MPU6050 connection.

    updateMPUHealth();

    // Continuously monitor movement.

    monitorMovement();

    // Soil moisture: every 1 second.

    if (now - lastSoilSample >=
        SOIL_SAMPLE_INTERVAL) {

        lastSoilSample = now;

        sampleSoilMoisture();
    }

    // Raindrop sensor: every 1 second.

    if (now - lastRainSample >=
        RAIN_SAMPLE_INTERVAL) {

        lastRainSample = now;

        sampleRainSensor();
    }

    // DHT11: every 1 second.

    if (now - lastDHTSample >=
        DHT_SAMPLE_INTERVAL) {

        lastDHTSample = now;

        sampleDHT11();
    }

    // Refresh dashboard every 2 seconds.

    if (now - lastDashboardRefresh >=
        DASHBOARD_INTERVAL) {

        lastDashboardRefresh = now;

        displayDashboard();
    }
}