# LeakLens con Selenium

Selenium no graba la red por sí solo, así que la integración tiene dos partes:

1. **Red:** el navegador pasa por un proxy que exporta HAR.
2. **Lo que ve la prueba:** `LeakLensSelenium.java` guarda el texto de las pantallas, el storage, las cookies (con su flag HttpOnly) y la consola en un bundle.

Con ambas partes, LeakLens también puede detectar sobreexposición.

## 1. Red con mitmproxy

[mitmproxy](https://mitmproxy.org) 10.1 o superior exporta HAR directamente:

```bash
mitmdump --listen-port 8081 --set hardump=./target/leaklens/red.har
```

Configura el navegador para usar el proxy:

```java
ChromeOptions options = new ChromeOptions();
options.addArguments("--proxy-server=http://127.0.0.1:8081");
// Solo en ambientes de prueba: confía en el certificado de mitmproxy o ignora errores TLS.
options.addArguments("--ignore-certificate-errors");
// Para capturar la consola del navegador:
LoggingPreferences logs = new LoggingPreferences();
logs.enable(LogType.BROWSER, Level.ALL);
options.setCapability("goog:loggingPrefs", logs);
WebDriver driver = new ChromeDriver(options);
```

El HAR se escribe al detener `mitmdump`. En CI, detenlo después de la suite (por ejemplo, con `kill -INT`).

> El HAR contiene datos completos. Guárdalo solo en el workspace del build y no lo publiques como artefacto.

## 2. Bundle de cada prueba

Copia `integrations/selenium/LeakLensSelenium.java` a tu proyecto. Funciona con Java 8+ y Selenium 3 o 4, sin dependencias extra.

```java
class PerfilTest {
  WebDriver driver;
  LeakLensSelenium leaklens;

  @BeforeEach
  void setUp(TestInfo info) {
    driver = new ChromeDriver(options);
    leaklens = new LeakLensSelenium(driver, info.getDisplayName());
  }

  @Test
  void clienteVeSuPerfil() {
    driver.get("https://qa.mibanco.test/perfil");
    leaklens.capturePage();              // después de cada pantalla relevante
    driver.findElement(By.id("pagar")).click();
    leaklens.capturePage();
  }

  @AfterEach
  void tearDown() throws IOException {
    leaklens.write(Paths.get("target/leaklens"));   // antes de quit()
    driver.quit();
  }
}
```

## 3. Análisis

```bash
npx leaklens scan --har "target/leaklens/*.har" --bundles "target/leaklens/**/leaklens.bundle.json"
```

### Sobreexposición con Selenium

LeakLens agrupa la evidencia por carpeta: una prueba equivale a un directorio. Con un único HAR para toda la suite, la red y las pantallas quedan en carpetas distintas y la sobreexposición no se evalúa. Para activarla, inicia un `mitmdump` por clase de prueba y escribe su HAR dentro de la misma carpeta del bundle.

## Alternativas a mitmproxy

- **BrowserMob Proxy:** `proxy.newHar()` y `proxy.getHar().writeTo(file)`.
- **Selenium 4 + DevTools (Chrome):** puedes registrar `Network.responseReceived` y escribir un HAR propio, o agregar entradas al campo `network` del bundle con el formato de [bundle-format.md](bundle-format.md).
