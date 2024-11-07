const express = require('express');
const fs = require('fs');
const csv = require('csv-parser');
const dotenv = require('dotenv');
const moment = require('moment');
const envFile = `.env${process.env.NODE_ENV ? `.${process.env.NODE_ENV}` : ''}`;
dotenv.config({ path: envFile });

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const CSV_FILE = process.env.CSV_FILE || 'events.csv';

app.use(express.json());
const events = new Map();
const sortFunctions = {
    name: (a, b) =>
        a.eventId - b.eventId || new Date(a.date) - new Date(b.date),
    date: (a, b) => new Date(a.date) - new Date(b.date)
};


function loadEventsFromCSV() {
    return new Promise((resolve, reject) => {
        fs.createReadStream('events.csv')
            .pipe(csv())
            .on('data', (data) => {
                const parsedEventId = parseInt((data.eventId || '').trim(), 10);
                const eventId = isNaN(parsedEventId) ? undefined : parsedEventId;
                const eventDateString = (data.eventDate || '').trim();
	        const parsedEventDate = moment(eventDateString, 'YYYY-MM-DD HH:mm:ss', true);
                const eventDate = parsedEventDate.isValid() ? parsedEventDate.toDate() : undefined
                
                if(!eventId || !eventDate){
		   return;
                }

                const eventKey = `${eventId}-${eventDate.toISOString()}`;
               
                const seat = {
                    seatNumber: parseInt(data.seatNumber, 10),
                    row: data.row,
                    level: data.level,
                    section: data.section,
                    status: data.status,
                    sellRank: parseInt(data.sellRank, 10),
                    hasUpsells: data.hasUpsells === 'true'
                };
    
		
                
		  if (!events.has(eventKey)) {
                     
                     events.set(eventKey, {
                        name: eventKey,
                        eventId: eventId,
                        eventDate: eventDate,
                        seats: []
                    });

			 
                  }
                 
		 events.get(eventKey).seats.push(seat);
                
            })
            .on('end', () => {
                console.log(`Number of events: ${events.size}, Total seats: ${[...events.values()].reduce((sum, event) => sum + event.seats.length, 0)}`);
                resolve();
            })
            .on('error', reject);
    });
}

app.get('/api/events', (req, res) => {
    const { sortBy } = req.query;
    let sortedEvents = [...events.values()];
    const criteria = sortBy ? sortBy.split(',') : ['name'];
    criteria.forEach((criterion) => {
        const sortFunction = sortFunctions[criterion];
        if (sortFunction) {
            sortedEvents.sort(sortFunction);
        }
    });

    res.json(sortedEvents);
});


app.post('/api/events/:id/book', (req, res) => {
    const eventId = parseInt(req.params.id, 10);
    const { quantity } = req.body;
    const matchingEvents = [...events.entries()]
    .filter(([key]) => key.startsWith(`${eventId}-`))  
    .map(([, event]) => event);
    matchingEvents.sort(sortFunctions.name);

    if (matchingEvents.length === 0) {
        return res.status(404).json({ message: "Oups. Unknown event" });
    }

   const availableSeats = matchingEvents
    .flatMap(event => event.seats)  
    .filter(seat => seat.status === 'OPEN')  
    .sort((a, b) => b.sellRank - a.sellRank);

    if (availableSeats.length < quantity) {
        return res.status(400).json({ message: "No seats available" });
    }

    const bestSeats = availableSeats.slice(0, quantity);
    bestSeats.forEach(seat => seat.status = 'BOOKED');

    res.json({
        message: "Seats booked successfully",
        seats: bestSeats.map(seat => ({
            seatNumber: seat.seatNumber,
            row: seat.row,
            level: seat.level,
            section: seat.section
        }))
    });
});


loadEventsFromCSV().then(() => {
    const PORT = 3000;
    app.listen(PORT, () => {
        console.log(`Server is running on port ${PORT}`);
    });
}).catch(error => {
    console.error("Oups. Failed to load events:", error);
});
