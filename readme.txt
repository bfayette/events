Guide

1. Cloner le projet et se rendre dans le répertoire du projet.
2. Installer les dépendances en exécutant la commande : `npm install`

Configuration

1. Créer un fichier `.env.development` avec les variables suivantes :
   PORT=3000
   CSV_FILE=events.csv

2. Créer un fichier `events.csv` avec les données d’événements suivantes (voir glossaire ) :
eventId,seatNumber,row,level,section,status,eventDate,sellRank,hasUpsells
95,0,23,y,o,OPEN,2025-01-01 00:00:00,0,false

Lancement de l'application

Exécuter la commande `npm run dev` pour démarrer le serveur en mode développement. Le serveur démarre par défaut sur le port spécifié dans `.env.development`.

Utilisation

1. Récupérer liste des événements 
   Requête GET à `http://localhost:3000/api/events`  
   Paramètre de requête optionnel : `sortBy` avec `name` ou `date`
curl "http://localhost:3000/api/events" -H "Content-Type: application/json" 


2. Réserver les meilleurs sièges  
   Requête POST à `http://localhost:3000/api/events/:id/book`  
   Corps de la requête JSON : `{ "quantity": <nombre de sièges> }`
	ex. curl -X POST "http://localhost:3000/api/events/95/book" -H "Content-Type: application/json" -d "{\"quantity\": 3}"


Glossaire des champs utilisés (hypothèses @ valider)
1- Name : Concaténation de eventId et eventDate identité de l'évènement
2- status : Indique la disponibilité du siège. Les statuts courants pourraient être: OPEN, BOOKED, HOLD 
3- sellRank : Un classement ou niveau de priorité qui indique la demande ou l’attractivité du siège.
4- hasUpsells : Une valeur booléenne (true ou false) indiquant s’il existe des options supplémentaires pour ce siège.
5- eventDate : La date et l’heure de l’événement, formatée comme YYYY-MM-DD HH:mm:ss.