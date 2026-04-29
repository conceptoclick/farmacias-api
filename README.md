# 🏥 Farmacias de Tenerife - API

API REST para consultar farmacias y servicios de guardia en Tenerife, Canarias.

## 🚀 Características

- **Base de datos completa**: +200 farmacias de Tenerife con geolocalización
- **Servicio de guardias**: Información actualizada cada hora
- **Búsqueda por proximidad**: Encuentra farmacias cercanas usando coordenadas GPS
- **Fallback inteligente**: Funciona incluso con caché vacío mediante scraping en tiempo real
- **Mapa interactivo**: Visualización con Leaflet.js

## 📡 Endpoints de la API

### `GET /api/status`
Estado del servidor y estadísticas.
```json
{
  "status": "ok",
  "farmacias": 250,
  "guardiasCached": 45,
  "lastUpdate": "2024-01-15T10:30:00Z",
  "isRefreshing": false
}
```

### `GET /api/guardia/cerca?lat=28.2916&lng=-16.6291&radio=10`
Farmacias de guardia cercanas a una ubicación.
| Parámetro | Tipo | Requerido | Descripción |
|-----------|------|-----------|-------------|
| lat | number | ✅ | Latitud (rango válido: 27.5-29) |
| lng | number | ✅ | Longitud (rango válido: -17 a -15.5) |
| radio | number | ❌ | Radio en km (default: 15) |

### `GET /api/guardia/hoy`
Lista completa de farmacias de guardia hoy.

### `GET /api/farmacias`
Todas las farmacias de la base de datos.

### `GET /api/farmacias/municipio/:nombre`
Farmacias filtradas por municipio.

### `GET /api/zonas`
Listado de zonas de guardia disponibles.

### `GET /api/municipios`
Listado de municipios disponibles.

## 🛠️ Instalación Local

```bash
# Clonar repositorio
git clone <url-del-repo>
cd farmacias-tenerife

# Instalar dependencias
npm install

# Iniciar servidor
npm start
```

El servidor estará disponible en `http://localhost:3000`

## 🐳 Docker

```bash
# Construir imagen
docker build -t farmacias-tenerife .

# Ejecutar contenedor
docker run -p 3000:3000 farmacias-tenerife
```

## 📦 Deploy en Vercel

1. Conectar repositorio a Vercel
2. El deployment es automático gracias a `vercel.json`
3. Variable de entorno opcional: `PORT` (default: 3000)

## ⚠️ Consideraciones

- **Rate Limiting**: La API respeta los límites de Nominatim OSM (1 req/seg)
- **Cache**: Las guardias se actualizan cada 60 minutos
- **Cold Start**: En el primer request se hace scraping rápido de la zona relevante

## 📄 Licencia

MIT

---
**Nota**: Esta API usa datos abiertos del Gobierno de Canarias y farmaciasdecanarias.com con fines informativos.
