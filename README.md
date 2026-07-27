# *Abitare Rurale*
### For DotDotDot, Milan. 

- **1.online_web** - tutto quello che serve per la versione online della mappa. Per adesso, usa solo un subset di dati, quelli che contengono info fotografiche sui dati, perche' github non supporta files .csv piu' grandi di 100MB. In "data/" ci sono sia i files sui 44363 punti, sia quelli ridotti a 432 punti. Contiene maputnik .json files per lo stile (cambia in app.js), colori per la palettes dei punti (cambia in index.html), png-manifest.json con le refs per visualizzare una foto della casa aorrispondente sulla mappa e diversi modi per visualizzaare con Three.js un modello 3D, oppure una scheda ("three-animation.js" fa apparire il trullo 3d animando le linee di contorno, "three-correct_png.js" fa apparire un'immagine della scheda corrispondente e "three-fade" fa apparire il trullo facendo un fade-in della scheda. Cambia in index.html per vedere le differenze). 
- **2.offline_data** - dati vettoriali piatti e raster in 3d per sviluppare la mappa in locale. Solo in un file zippato perche' sono 6GB. 
- **3.dati_schede** - analisi dati e trattamento delle schede che contengono immagini. In tutto, 44363 punti, ma solo 432 cartelle con immagini, e quiundi da visualizzare sulla mappa. Nelle cartelle, 18GB quindi molto nel gitignore. trattamento dati nei python notebooks. 


<p align="center">
  <img src="img.png" alt="Abitare Rurale preview" width="50%">
</p>