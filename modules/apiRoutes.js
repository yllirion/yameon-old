// modules/apiRoutes.js
module.exports = function(app, fs, path) {

    // --- Fleets CRUD ---
    app.get('/api/fleets', async (req, res) => {
        try {
            const dir = path.join(__dirname, '..', 'public', 'fleets');
            const files = await fs.readdir(dir);
            const fleets = [];
            for (const file of files) {
                if (file.endsWith('.json')) {
                    const json = await fs.readFile(path.join(dir, file), 'utf8');
                    fleets.push(JSON.parse(json));
                }
            }
            res.json(fleets);
        } catch (err) {
            console.error('GET /api/fleets error', err);
            res.status(500).json({ error: 'Не удалось загрузить флоты' });
        }
    });

    app.post('/api/fleets', async (req, res) => {
        try {
            const fleet = req.body;
            fleet.id = `fleet_${Date.now()}`;
            const file = path.join(__dirname, '..', 'public', 'fleets', `${fleet.id}.json`);
            await fs.writeFile(file, JSON.stringify(fleet, null, 2), 'utf8');
            res.json({ id: fleet.id });
        } catch (err) {
            console.error('POST /api/fleets error', err);
            res.status(500).json({ error: 'Не удалось сохранить флот' });
        }
    });

    app.put('/api/fleets/:id', async (req, res) => {
        try {
            const id = req.params.id;
            const file = path.join(__dirname, '..', 'public', 'fleets', `${id}.json`);
            await fs.writeFile(file, JSON.stringify(req.body, null, 2), 'utf8');
            res.json({ success: true });
        } catch (err) {
            console.error(`PUT /api/fleets/${id} error`, err);
            res.status(500).json({ error: 'Не удалось обновить флот' });
        }
    });

    app.delete('/api/fleets/:id', async (req, res) => {
        try {
            const id = req.params.id;
            const file = path.join(__dirname, '..', 'public', 'fleets', `${id}.json`);
            await fs.unlink(file);
            res.json({ success: true });
        } catch (err) {
            console.error(`DELETE /api/fleets/${id} error`, err);
            res.status(500).json({ error: 'Не удалось удалить флот' });
        }
    });

    // --- Ships CRUD ---
    app.get('/api/ships', async (req, res) => {
        try {
            const dir = path.join(__dirname, '..', 'public', 'ships');
            const files = await fs.readdir(dir);
            const ships = [];
            for (const file of files) {
                if (file.endsWith('.json')) {
                    const json = await fs.readFile(path.join(dir, file), 'utf8');
                    ships.push(JSON.parse(json));
                }
            }
            res.json(ships);
        } catch (err) {
            console.error('GET /api/ships error', err);
            res.status(500).json({ error: 'Не удалось загрузить проекты кораблей' });
        }
    });

    app.post('/api/ships', async (req, res) => {
        try {
            const ship = req.body;
            ship.id = ship.id || `ship_${Date.now()}`;
            const file = path.join(__dirname, '..', 'public', 'ships', `${ship.id}.json`);
            await fs.writeFile(file, JSON.stringify(ship, null, 2), 'utf8');
            res.json({ id: ship.id });
        } catch (err) {
            console.error('POST /api/ships error', err);
            res.status(500).json({ error: 'Не удалось сохранить проект корабля' });
        }
    });

    app.put('/api/ships/:id', async (req, res) => {
        try {
            const id = req.params.id;
            const file = path.join(__dirname, '..', 'public', 'ships', `${id}.json`);
            await fs.writeFile(file, JSON.stringify(req.body, null, 2), 'utf8');
            res.json({ success: true });
        } catch (err) {
            console.error(`PUT /api/ships/${id} error`, err);
            res.status(500).json({ error: 'Не удалось обновить проект корабля' });
        }
    });

    app.delete('/api/ships/:id', async (req, res) => {
        try {
            const id = req.params.id;
            const file = path.join(__dirname, '..', 'public', 'ships', `${id}.json`);
            await fs.unlink(file);
            res.json({ success: true });
        } catch (err) {
            console.error(`DELETE /api/ships/${id} error`, err);
            res.status(500).json({ error: 'Не удалось удалить проект корабля' });
        }
    });

    // --- Modules List ---
    app.get('/api/modules', async (req, res) => {
        try {
            const file = path.join(__dirname, '..', 'public', 'modules', 'modules.json');
            const json = await fs.readFile(file, 'utf8');
            res.json(JSON.parse(json));
        } catch (err) {
            console.error('GET /api/modules error', err);
            res.status(500).json({ error: 'Не удалось загрузить модули' });
        }
    });

};
