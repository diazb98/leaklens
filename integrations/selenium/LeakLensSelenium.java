package leaklens.selenium;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

import org.openqa.selenium.Cookie;
import org.openqa.selenium.JavascriptExecutor;
import org.openqa.selenium.WebDriver;
import org.openqa.selenium.logging.LogEntry;
import org.openqa.selenium.logging.LogType;

/**
 * Integración de LeakLens para Selenium (Java 8+, Selenium 3 o 4). Sin dependencias extra.
 *
 * Guarda lo que la prueba ve además de la red: texto visible de cada pantalla, URLs,
 * localStorage, sessionStorage, cookies (con su flag HttpOnly) y la consola del navegador.
 * La red se captura con un proxy que exporte HAR (ver docs/selenium.md).
 *
 * Uso con JUnit 5:
 *
 *   private LeakLensSelenium leaklens;
 *
 *   @BeforeEach void setUp(TestInfo info) {
 *     leaklens = new LeakLensSelenium(driver, info.getDisplayName());
 *   }
 *
 *   // Después de cada pantalla importante (opcional):
 *   leaklens.capturePage();
 *
 *   @AfterEach void tearDown() throws IOException {
 *     leaklens.write(Paths.get("target/leaklens"));   // antes de driver.quit()
 *   }
 */
public class LeakLensSelenium {

    private static final int MAX_TEXT = 1_000_000;

    private final WebDriver driver;
    private final String testTitle;
    private final List<String[]> pages = new ArrayList<>();
    private final Set<String> urls = new LinkedHashSet<>();

    public LeakLensSelenium(WebDriver driver, String testTitle) {
        this.driver = driver;
        this.testTitle = testTitle;
    }

    /** Guarda el texto visible de la pantalla actual. Llámalo después de cada paso relevante. */
    public void capturePage() {
        try {
            String url = driver.getCurrentUrl();
            urls.add(url);
            Object text = js("return document.body ? document.body.innerText : '';");
            if (text instanceof String && !((String) text).isEmpty()) {
                String t = (String) text;
                pages.add(new String[] { url, t.length() > MAX_TEXT ? t.substring(0, MAX_TEXT) : t });
            }
        } catch (RuntimeException ignored) {
            // La pantalla puede estar navegando: se intenta en la siguiente captura.
        }
    }

    /** Escribe dir/<prueba>/leaklens.bundle.json. Llamar antes de driver.quit(). */
    public Path write(Path dir) throws IOException {
        capturePage();
        StringBuilder sb = new StringBuilder(4096);
        sb.append("{\"leaklens\":1,\"tool\":\"selenium\",\"test\":{\"title\":").append(q(testTitle)).append("},");

        sb.append("\"pages\":[");
        for (int i = 0; i < pages.size(); i++) {
            if (i > 0) sb.append(',');
            sb.append("{\"url\":").append(q(pages.get(i)[0])).append(",\"text\":").append(q(pages.get(i)[1])).append('}');
        }
        sb.append("],\"urls\":[");
        int i = 0;
        for (String u : urls) {
            if (i++ > 0) sb.append(',');
            sb.append(q(u));
        }
        sb.append("],");

        sb.append("\"localStorage\":").append(storageJson("localStorage")).append(',');
        sb.append("\"sessionStorage\":").append(storageJson("sessionStorage")).append(',');

        sb.append("\"cookies\":[");
        i = 0;
        try {
            for (Cookie c : driver.manage().getCookies()) {
                if (i++ > 0) sb.append(',');
                sb.append("{\"name\":").append(q(c.getName()))
                  .append(",\"value\":").append(q(c.getValue()))
                  .append(",\"domain\":").append(q(c.getDomain()))
                  .append(",\"httpOnly\":").append(c.isHttpOnly())
                  .append(",\"secure\":").append(c.isSecure()).append('}');
            }
        } catch (RuntimeException ignored) {
            // Sin sesión activa.
        }
        sb.append("],");

        sb.append("\"console\":[");
        i = 0;
        try {
            // Requiere ChromeOptions con: options.setCapability("goog:loggingPrefs", Map.of("browser", "ALL"))
            for (LogEntry e : driver.manage().logs().get(LogType.BROWSER)) {
                if (i++ > 0) sb.append(',');
                sb.append("{\"type\":").append(q(e.getLevel().getName().toLowerCase()))
                  .append(",\"text\":").append(q(e.getMessage())).append('}');
            }
        } catch (RuntimeException ignored) {
            // El navegador o el driver no exponen logs (Firefox, Safari).
        }
        sb.append("]}");

        Path out = dir.resolve(slug(testTitle));
        Files.createDirectories(out);
        Path file = out.resolve("leaklens.bundle.json");
        Files.write(file, sb.toString().getBytes(StandardCharsets.UTF_8));
        return file;
    }

    private String storageJson(String name) {
        try {
            Object v = js("try { var s = window." + name + ", o = {};"
                + " for (var i = 0; i < s.length; i++) { var k = s.key(i); o[k] = s.getItem(k); }"
                + " return JSON.stringify(o); } catch (e) { return '{}'; }");
            return v instanceof String ? (String) v : "{}";
        } catch (RuntimeException e) {
            return "{}";
        }
    }

    private Object js(String script) {
        return ((JavascriptExecutor) driver).executeScript(script);
    }

    private static String slug(String s) {
        String t = java.text.Normalizer.normalize(s == null ? "prueba" : s, java.text.Normalizer.Form.NFD)
            .replaceAll("\\p{M}", "")
            .replaceAll("[^A-Za-z0-9._-]+", "-")
            .replaceAll("^-+|-+$", "");
        if (t.isEmpty()) t = "prueba";
        return t.length() > 80 ? t.substring(0, 80) : t;
    }

    /** Cadena JSON con escape completo. */
    static String q(String s) {
        if (s == null) return "null";
        StringBuilder b = new StringBuilder(s.length() + 2).append('"');
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"': b.append("\\\""); break;
                case '\\': b.append("\\\\"); break;
                case '\n': b.append("\\n"); break;
                case '\r': b.append("\\r"); break;
                case '\t': b.append("\\t"); break;
                default:
                    if (c < 0x20) b.append(String.format("\\u%04x", (int) c));
                    else b.append(c);
            }
        }
        return b.append('"').toString();
    }
}
