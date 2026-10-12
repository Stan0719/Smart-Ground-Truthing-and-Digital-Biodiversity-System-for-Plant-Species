#include <Wire.h>
#include <math.h>
#include <DHT.h>
#include <Adafruit_MPU6050.h>
#include <Adafruit_Sensor.h>

// ========== PIN CONFIGURATION ==========
#define LED_PIN 5
#define DHT_PIN 4
#define DHT_TYPE DHT11

#define SOIL_PIN 35
#define RAIN_PIN 34   
#define SOUND_PIN 32

// ========== SENSOR OBJECTS ==========
DHT dht(DHT_PIN, DHT_TYPE);
Adafruit_MPU6050 mpu;

bool mpuReady = false;

// ========== IMU BASELINE ==========
float baseX = 0;
float baseY = 0;
float baseZ = 0;
bool baselineSet = false;

// ========== SETUP ==========
void setup() {
  Serial.begin(115200);

  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, LOW);

  pinMode(SOIL_PIN, INPUT);
  pinMode(RAIN_PIN, INPUT);
  pinMode(SOUND_PIN, INPUT);

  // Initialize DHT11
  dht.begin();

  // Initialize MPU6050
  Wire.begin(21, 22);

  Serial.println("\n===== BIODIVERSITY SENSOR SYSTEM =====");

  if (mpu.begin()) {
    mpuReady = true;

    mpu.setAccelerometerRange(MPU6050_RANGE_4_G);
    mpu.setGyroRange(MPU6050_RANGE_500_DEG);
    mpu.setFilterBandwidth(MPU6050_BAND_21_HZ);

    Serial.println("MPU6050: CONNECTED");
    Serial.println("Keep the IMU still during calibration...");

    // Collect baseline readings
    const int samples = 100;

    float sumX = 0;
    float sumY = 0;
    float sumZ = 0;

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

    Serial.println("IMU baseline calibration complete.");
    Serial.printf("Baseline X: %.2f\n", baseX);
    Serial.printf("Baseline Y: %.2f\n", baseY);
    Serial.printf("Baseline Z: %.2f\n", baseZ);

  } else {
    Serial.println("MPU6050: NOT DETECTED");
  }

  Serial.println("System ready!\n");
}

// ========== MAIN LOOP ==========
void loop() {

  // 1. SOIL MOISTURE SENSOR
  int soilValue = analogRead(SOIL_PIN);

  Serial.println("\n========== SENSOR READINGS ==========");

  Serial.print("Soil Moisture: ");
  Serial.println(soilValue);


  // 2. RAIN SENSOR
  int rainValue = analogRead(RAIN_PIN);

  Serial.print("Rain Sensor: ");
  Serial.println(rainValue);


  // 3. SOUND SENSOR
  int soundValue = analogRead(SOUND_PIN);

  Serial.print("Sound Sensor: ");
  Serial.println(soundValue);


  // 4. DHT11 TEMPERATURE AND HUMIDITY
  float temperature = dht.readTemperature();
  float humidity = dht.readHumidity();

  if (!isnan(temperature) && !isnan(humidity)) {

    Serial.print("Temperature: ");
    Serial.print(temperature);
    Serial.println(" C");

    Serial.print("Humidity: ");
    Serial.print(humidity);
    Serial.println(" %");

  } else {
    Serial.println("DHT11: Reading failed!");
  }


  // 5. MPU6050 IMU — X, Y, Z AXES
  if (mpuReady && baselineSet) {

    sensors_event_t a, g, temp;
    mpu.getEvent(&a, &g, &temp);

    float ax = a.acceleration.x;
    float ay = a.acceleration.y;
    float az = a.acceleration.z;

    float deltaX = fabs(ax - baseX);
    float deltaY = fabs(ay - baseY);
    float deltaZ = fabs(az - baseZ);

    Serial.println("\n---------- MPU6050 IMU ----------");

    Serial.printf("X-axis: %.2f m/s^2 | Change: %.2f\n",
                  ax, deltaX);

    Serial.printf("Y-axis: %.2f m/s^2 | Change: %.2f\n",
                  ay, deltaY);

    Serial.printf("Z-axis: %.2f m/s^2 | Change: %.2f\n",
                  az, deltaZ);

    if (deltaX > 2.0) {
      Serial.println("IMU: X-axis acceleration change detected!");
    }

    if (deltaY > 2.0) {
      Serial.println("IMU: Y-axis acceleration change detected!");
    }

    if (deltaZ > 2.0) {
      Serial.println("IMU: Z-axis acceleration change detected!");
    }
  }


  // 6. LED CONTROL — SOUND SENSOR ONLY
  if (soundValue < 2000) {

    digitalWrite(LED_PIN, HIGH);
    Serial.println("\nALERT: Sound reading below 2000 — LED ON");

  } else {

    digitalWrite(LED_PIN, LOW);
    Serial.println("\nNormal: Sound reading >= 2000 — LED OFF");

  }


  Serial.println("====================================");

  delay(1000);
}