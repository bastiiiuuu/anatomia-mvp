## Visor público

[**Abrir Atlas 3D**](https://bastiiiuuu.github.io/anatomia-mvp/) · gratuito, con estudio muscular por secciones y sin instalar Python.

La edición de GitHub Pages es una aplicación estática completa: `index.html` es su entrada, `site-data/` contiene 29 capítulos de fichas y `static/models/` conserva los tres GLB con sus licencias. Los enlaces respetan `/anatomia-mvp/`; se versionan módulos, modelos y capítulos por contenido para evitar mezclar archivos de dos publicaciones.

`tools/export_pages.py` genera esta edición desde el mismo catálogo del backend. La publicación se reconstruye y despliega automáticamente en cada push a `main` mediante `.github/workflows/pages.yml` (Settings → Pages → GitHub Actions). El workflow verifica también las pruebas Python. La versión pública consulta Wikipedia mediante la API CORS, sin proxies privados ni claves; si falla la red, mantiene la ficha local y el enlace al artículo. La versión local conserva FastAPI y su caché de Wikipedia.

Para generar una copia publicable manualmente: `./.venv/Scripts/python.exe tools/export_pages.py`. No publiques `.venv`, archivos de credenciales ni capturas de QA. El workflow empaqueta únicamente la entrada HTML, `static/`, `site-data/` y `.nojekyll`.

## Iniciar

Desde esta carpeta, en PowerShell:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\start.ps1
```

El servidor está configurado para recargar al guardar Python, HTML, CSS o JavaScript. Si ya está ejecutándose en 8000, utiliza esa instancia y recarga la pestaña. No necesitas instalar Blender. El entorno Python existente sigue siendo suficiente; no se agregaron paquetes.

Para abrirlo en una tablet física, conecta ambos equipos a la misma Wi-Fi y abre `http://IP_DEL_PC:8000` en la tablet. `start.ps1` escucha también en la red local; consulta la IPv4 del adaptador Wi-Fi con `ipconfig`. Si Windows pide acceso, permite la aplicación en tu red privada. Para ejecutarlo exclusivamente en el PC: `./start.ps1 -BindAddress 127.0.0.1`. `127.0.0.1` en la tablet se refiere a la propia tablet.

## Modelos y procedencia

| Archivo | Tamaño aproximado | Procedencia |
| --- | --- | --- |
| `static/models/skeleton.glb` | 2,60 MiB | Export JMK712/human-anatomy-online de Z-Anatomy |
| `static/models/muscular.glb` | 8,41 MiB | Export JMK712/human-anatomy-online de Z-Anatomy |
| `static/models/articular.glb` | 1,47 MiB | Export Anatria3D de Z-Anatomy |

Los modelos se mantienen separados y sin modificar. Comparten el espacio corporal del dataset; se conservan las transformaciones originales, incluidos nodos reflejados. Los dos primeros se descargaron del commit `e13af7f4dfbe3336b7b588b8458805cd2971ef4e`; la revisión exacta del tercero está registrada en `static/models/SOURCES.md`.

La capa articular incorpora geometrías reales de ligamentos cruzados, ligamentos longitudinales, cápsulas, meniscos y discos, entre otras estructuras. El inventario se limita a lo que existe en los archivos: no se generan piezas falsas para rellenar huecos del dataset. No supone cobertura de todos los tejidos o variantes anatómicas.

Se conservan licencias, atribuciones y procedencia en `static/models/`. Los assets masculinos de Anatria3D y su nomenclatura son CC BY-SA 4.0; no se copió código de su aplicación. El proyecto conserva la cadena de crédito Z-Anatomy / BodyParts3D / DBCLS y los exportadores. La columna de nombres españoles procede del catálogo distribuido por Z-Anatomy; sus coincidencias exactas están en `data/real_translations.json`.

Three.js 0.180.0, OrbitControls y GLTFLoader mantienen el CDN del proyecto original. Los decodificadores Draco se sirven localmente desde `static/vendor/draco/`, con su licencia. No se contrata ningún servicio. La primera carga de las bibliotecas requiere red; Wikipedia también la requiere. Las respuestas del servicio enciclopédico se conservan solamente en RAM.

## Selección y aislamiento automático de músculos

El inicio ahora muestra **Músculos**. El explorador permite estudiar **13 secciones**: cabeza/cara, cuello, tórax, abdomen, espalda, hombro, brazo, antebrazo, mano, pelvis/glúteos, muslo, pierna y pie. Elige una sección para ocultar el resto y ajustar la cámara a su geometría real. Puedes restringirla por lado del paciente y por grupos del catálogo, como manguito rotador, compartimentos del muslo o grupos glúteos. La clasificación usa la nomenclatura del atlas; no corta geometrías ni supone que todos los grupos sean planos superficiales/profundos.

**Resto del cuerpo → Transparente** conserva contexto al 15 %. **Volver a la sección** restaura el grupo tras estudiar una pieza aislada. Al ocultar una pieza automáticamente aislada, vuelven las demás piezas del grupo; **Restaurar piezas ocultas de la sección** permite recuperar esa disección sin regresar al cuerpo entero.

En tablet horizontal, la ficha se abre con **Ficha** y **Explorador** permite ocultar la barra lateral. En vertical, ambos paneles son desplegables y el visor ocupa todo el ancho. Un dedo gira; dos dedos acercan y desplazan. **Nitidez → Automática** limita la densidad a 1,5 en móviles y la adapta al tiempo entre cuadros durante la interacción; **Alta** limita la densidad a 2 y **Fluida** a 1. Además se aplica un presupuesto de 1,8 millones de píxeles en móviles, que puede reducir esos límites en visores grandes. La geometría mantiene todos sus triángulos en cualquier modo: no se simplifican las fibras ni las estructuras seleccionadas.

La opción **Aislar músculo al seleccionarlo** está activada por defecto. Al buscar un músculo, hacer clic en su resultado, pulsarlo en la lista o seleccionarlo sobre el modelo:

1. La capa muscular se activa y la pieza seleccionada se vuelve visible.
2. Aparece su etiqueta y ficha. En contexto la selección es **verde**; al aislarla se restaura el material anatómico original del GLB, incluidos color, sombreado y mapas disponibles, sin emisión verde. Salir del aislamiento vuelve al verde. Deseleccionar devuelve todos los materiales originales.
3. Se ocultan las demás estructuras con el modo inicial **Solo la pieza**, o se atenúan si elegiste **Rayos X**.
4. La selección muscular aislada centra y acerca la cámara al `Box3` real de la estructura, también al hacer clic en el modelo.

La opción es reversible: desmárcala para estudiar el músculo con contexto; el botón **Salir de aislamiento** también restaura las demás capas activas. Seleccionar un hueso o ligamento sale del aislamiento automático muscular. Las mallas de distintas cabezas o porciones mantienen sus nombres propios: si eliges “Bíceps braquial · cabeza corta”, se aísla esa cabeza, no se presentan otras partes como si fueran la misma pieza.

El aislamiento manual conserva los modos **Rayos X · 15 %** y **Solo la pieza**. **Ocultar pieza** permite disección progresiva y restauración. **Rayos X / Aislar** actúa sobre la selección actual; sin selección atenúa huesos y músculos para explorar capas profundas.

## Explorar

- Pestañas **Esqueleto**, **Músculos**, **Articulaciones** y **Sistemas** para cambiar rápidamente la vista. El inicio prioriza el estudio muscular.
- Switches independientes para huesos, músculos, articulaciones/ligamentos/tendones, cartílagos/discos y otros tejidos (fascias, bursas y vainas).
- Selector de regiones: Cuerpo Completo, Cabeza y Columna, Tórax y Abdomen, Miembro Superior, Pelvis y Miembro Inferior. Enfoca la región y filtra la lista sin borrar el contexto espacial de las demás regiones.
- Buscador superior local sobre los nombres/aliases precalculados del catálogo servido por el backend, sin solicitudes por cada pulsación. El filtro de ESTRUCTURAS usa páginas de 40 filas. Enter selecciona la primera coincidencia. Prueba `Clavícula`, `C4`, `LCA`, `LCP`, `Bíceps braquial`, `Recto femoral`, `Calcáneo` o `Aquiles`.
- Clic corto selecciona; arrastrar gira con OrbitControls. `/` enfoca el buscador. Flechas/Enter/Escape navegan los resultados.
- ⟲ restaura visibilidad y vista completa; A/P enfocan desde anterior/posterior. La cámara se adapta al tamaño de la pantalla.

## Arquitectura final

`backend/real_catalog.py` lee las cabeceras JSON de los tres GLB al arrancar y construye el catálogo activo en memoria. Cada ID se deriva de la identidad anatómica original, incluida su lateralidad. Se incluyen **1.373 estructuras**: huesos, dientes, músculos, ligamentos/otros componentes conectivos, cartílagos y otros tejidos. Este número cuenta estructuras del exportador y no equivale a cantidad de huesos o músculos de una persona.

Las tablas `node_bindings` vinculan índices originales del GLB con IDs exactos. GLTFLoader conserva esos índices en `parser.associations`, por lo que no dependemos de los nombres que Three.js sanea ni de sufijos ambiguos. T1 y T10 no se confunden. Los marcadores gráficos de sistema `.g` se excluyen; no son órganos. Los índices sin una ficha o exclusión explícita producen un error claro.

`data/z_anatomy_manifest.json` aporta nomenclatura latina/inglesa y jerarquía de la fuente. `data/real_translations.json` conserva solo traducciones españolas exactas de nombres existentes en estos modelos. Las equivalencias locales explícitas mantienen nombres comunes y aliases. Se preserva el nombre original cuando falta una traducción. Las notas de origen, inserción, inervación y función se reutilizan solo donde existe una correspondencia explícita con el catálogo de estudio local; en el resto quedan pendientes.

`static/viewer.js` carga GLTFLoader + DRACOLoader, aplica materiales por sistema y gestiona selección y herramientas. El encuadre considera los ocho vértices del Box3 en coordenadas de cámara, con margen horizontal/vertical. Las capas y el aislamiento operan sobre todas las primitivas del mismo ID. El render se actualiza al cambiar la escena, mover controles o animar la cámara; no se vuelve a dibujar continuamente un modelo estático de millones de triángulos.

## Rendimiento y segunda auditoría

El cliente descarga y decodifica inicialmente solo `muscular.glb`. Las otras capas se cargan una vez al seleccionarlas o buscar una pieza que las necesite. `/api/scene` transmite un catálogo compacto con todas las identidades, aliases y vínculos; las fichas clínicas completas se consultan al seleccionarlas y se guardan en una caché de hasta 128 fichas. Los documentos de escena y metadatos se serializan/comprimen al arrancar, con ETag y respuestas 304, sin recompresión por solicitud.

- `static/batch-worker.js` transforma vértices y normales fuera del hilo de interfaz; usa buffers transferibles. Se conserva el orden correcto de los triángulos reflejados.
- `static/batch-renderer.js` reúne geometrías estáticas por región/material. Cambiar visibilidad modifica únicamente índices. Funciona sin extensiones multi-draw. La pieza seleccionada usa una malla independiente con su geometría y transformaciones originales; las mallas de origen permanecen en CPU para picking exacto.
- `static/materials.js` comparte variantes inmutables natural/verde/transparente. Los materiales musculares originales se conservan en vez de reemplazarse por una paleta artificial. El contexto translúcido usa una sola pasada.
- `static/performance.js` administra un único rAF bajo demanda; duerme tras el movimiento y pausa al ocultar la pestaña o salir el visor de pantalla. La resolución automática se adapta con muestras de interacción, sin confundir el reposo con un bajo FPS.
- Al detener la cámara, recupera la nitidez automática en el último fotograma y conserva la resolución aprendida para el siguiente gesto. No añade un bucle en reposo; la recuperación durante el movimiento admite también pantallas de 60 Hz. Los buscadores táctiles usan texto de 16 px para evitar el zoom de enfoque de algunos navegadores móviles.
- El raycasting descarta primero las cajas que no toca el rayo y poda candidatos más lejanos que la intersección relevante. Un gesto con dos dedos nunca termina como selección accidental.
- En aislamiento con contexto transparente, prueba primero los triángulos de la pieza seleccionada: si hay impacto, no recorre el cuerpo fantasma. La prioridad visual permanece igual y un toque fuera de esa pieza conserva la búsqueda normal.
- Los listeners personalizados de puntero son pasivos. Las etiquetas se actualizan solo al dibujar, reutilizando vectores y medidas. La lista delega eventos y limita el DOM a 40 filas. En pantallas táctiles se desactivan MSAA y desenfoques de paneles; el modo de desarrollo no hace polling.
- La salida del visor cancela RAF, fetches, temporizadores, observers y listeners; termina el worker y libera geometrías, materiales, texturas y contexto WebGL. El ciclo bfcache pausa y reanuda conservando el estudio.

Medición reproducible: Chrome headless con SwiftShader, viewport 768×1024, entrada táctil y densidad de dispositivo 3. `artifacts/performance-before.json` y `artifacts/performance-after.json` conservan los resultados. No representa una medición de GPU física ni demuestra 60 FPS universales.

| Métrica | Antes | Después |
| --- | ---: | ---: |
| Tiempo hasta visor listo en esta ejecución | 3.207 ms | 1.617 ms |
| Llamadas de dibujo del cuerpo muscular | 461 | 14 |
| Triángulos visibles | 1.819.008 | 1.819.008 |
| Geometrías subidas a GPU | 461 | 14 |
| Materiales en mallas de origen cargadas | 1.373 | 2 |
| Filas DOM | 1.373 | 40 |
| Callbacks RAF durante 600 ms en reposo | 36 | 0 |

El rendimiento real al girar el cuerpo completo aún depende de la GPU, temperatura y navegador: quedan 1,8 millones de triángulos en esa vista. Las secciones y el aislamiento reducen la geometría visible sin sacrificar detalle. Se requiere una medición en hardware físico para certificar el objetivo de 60 FPS. El diagnóstico disponible exclusivamente en `?debug=1` registra frames, resolución, lotes, tiempos de selección y picking para esa siguiente auditoría.

La revisión posterior de memoria comparte el buffer maestro de índices entre las pasadas y usa rangos contiguos para selecciones sencillas. Los buffers de reordenación se crean solamente para filtros que los necesitan. En la carga muscular inicial, esto reduce los arrays de índices preparados de 46.529.640 a 23.264.820 bytes, manteniendo los 1.819.008 triángulos visibles y 14 llamadas de dibujo. Las cajas de cada pasada se recalculan a partir de las piezas activas, para que el frustum culling descarte la geometría que ya no pertenece al filtro. Las descargas GLB son cancelables y verifican el tamaño del catálogo; las consultas JSON y Wikipedia tienen tiempo límite.

La siguiente revisión compacta únicamente las normales de los lotes con enteros normalizados de 16 bits. Sus arrays de vértices musculares pasan de 32.584.944 a 24.438.708 bytes (25 % menos), sin cambiar posiciones, índices ni triángulos. La pieza seleccionada conserva los atributos originales en Float32. La comprobación de 90.876 muestras de las tres capas obtuvo un error vectorial máximo de normales de 0,0000261 y verifica también los reflejos bilaterales. La cancelación entre lotes termina el worker y rechaza la carga sin dejar geometrías ni promesas pendientes.

Seleccionar dentro de Rayos X global transforma esa vista en aislamiento transparente de la pieza: usa su material natural, incluso si el aislamiento automático está desmarcado. Un único toque para salir restaura el resaltado verde.

El catálogo procedural previo y los scripts Blender permanecen como material de desarrollo y pruebas, fuera de la escena activa. No se usa un fallback silencioso al modelo procedural si falla un GLB.

## Fichas y Wikipedia

Cada selección solicita `/api/estructuras/{Mesh_ID}/wikipedia`. El backend usa un título español explícito, consulta `https://es.wikipedia.org/api/rest_v1/page/summary/{titulo}`, devuelve texto plano con artículo/revisión/atribución y mantiene una LRU en RAM de hasta 256 resúmenes. Los resultados correctos duran 6 horas, los fallos 60 segundos; las consultas concurrentes de un mismo artículo se unen.

Las respuestas antiguas no pueden sobrescribir la ficha de una selección nueva. Una ausencia, desambiguación, fallo de red o falta de correspondencia editorial se muestra como estado, conservando la ficha local. No se descarga HTML, imágenes o miniaturas. Se puede definir `WIKIPEDIA_USER_AGENT` con un contacto real para una instalación pública.

Las porciones palpebral/orbitaria del orbicular y otras cabezas musculares con correspondencia explícita enlazan al artículo español del músculo completo. La ficha señala ese alcance y conserva las notas de cada pieza: no atribuye automáticamente información del músculo completo a una porción. Una errata ortográfica del nombre palpebral se corrige únicamente en la presentación, preservando la traducción fuente y el término latino.

La nomenclatura y geometría proceden de un atlas abierto; eso no certifica todas las notas ni la correspondencia con artículos. Las notas locales siguen pendientes de revisión docente. Si la selección corresponde a una porción, se indica cuando las notas se refieren al músculo o ligamento completo. Los títulos se toman del nombre explícito o del diccionario y no se asignan por una búsqueda difusa que pueda confundir estructuras.

| Ruta | Uso |
| --- | --- |
| `/api/metadata` | Catálogo real, jerarquía, assets y vínculos por nodo |
| `/api/scene` | Identidades y nombres compactos, comprimidos y revalidables |
| `/api/buscar?q=LCA` | IDs exactos y fichas |
| `/api/estructuras/{Mesh_ID}` | Ficha individual |
| `/api/estructuras/{Mesh_ID}/wikipedia` | Resumen o estado de consulta |
| `/api/health` | Estado y número de estructuras |
| `/docs` | Documentación interactiva |

## Comprobación

```powershell
$env:PYTHONDONTWRITEBYTECODE = '1'
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
node --check static/viewer.js
```

Las pruebas Python validan búsqueda, fichas, jerarquía, lateralidad, T1/T10, correspondencia exacta de todos los nodos y assets, clasificación anatómica y caché/concurrencia/errores de Wikipedia. Para las pruebas de navegador utiliza la instalación existente de Playwright y Chrome:

```powershell
$env:PLAYWRIGHT_MODULE = 'C:\ruta\a\node_modules\playwright'
$env:BROWSER_EXECUTABLE = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
node tools/browser-smoke.cjs
node tools/tablet-smoke.cjs
node tools/performance-smoke.cjs
node tools/picking-smoke.cjs
node tools/resolution-smoke.cjs
node tools/geometry-smoke.cjs
node tools/static-smoke.cjs
```

La prueba decodifica los tres GLB, comprueba sus 1.373 identidades y verifica selección por raycasting, cámara, regiones, Wikipedia, aislamiento automático muscular por buscador/lista/canvas, restauración, ocultación, filtros y móvil. Las capturas solo se escriben si se proporciona `ATLAS_SCREENSHOT`.

La prueba de tablet usa pantallas horizontal/vertical, densidad 2 y entrada táctil emulada. Comprueba regiones/grupos/lados, resolución física del canvas, encuadre, paneles, gesto de pinza, selección de una porción palpebral y vuelta a la sección. Actualiza dos capturas en `artifacts/viewer-tablet-landscape.png` y `artifacts/viewer-tablet-portrait.png`.

La prueba de rendimiento añade densidad 3, carga diferida, límite del DOM, llamadas de dibujo, reposo sin RAF, transiciones de color, material original en aislamiento, suspensión/reanudación y liberación de recursos GPU. El test de navegador verifica también posiciones transformadas originales en todos los lotes, incluida la lateralidad reflejada.

La prueba estática utiliza un servidor HTTP sin Python bajo el prefijo `/anatomia-mvp/`, comprueba las tres capas, fichas por capítulos, Wikipedia, color de selección/aislamiento y evita cualquier llamada a `/api/`. `ATLAS_PUBLIC_URL` permite ejecutar la misma prueba contra la publicación real.
