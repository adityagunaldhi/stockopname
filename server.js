const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const ExcelJS = require('exceljs');

const app = express();
app.use(express.json());
app.use(cors());

const bodyParser = require('body-parser');
app.use(bodyParser.json());

// Koneksi ke database MySQL
const db = mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: '', // Ganti sesuai dengan password MySQL Anda
    database: 'storage'
});

db.connect(err => {
    if (err) {
        console.error('Database connection failed:', err);
    } else {
        console.log('Connected to MySQL database');
    }
});

// Endpoint untuk menambahkan material
app.post('/materials', (req, res) => {
    const { id_material, material_name, stock, quantity } = req.body;
    const sql = 'INSERT INTO material (id_material, material_name, stock, quantity) VALUES (?, ?, ?, ?)';
    db.query(sql, [id_material, material_name, stock, quantity], (err, result) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json({ message: 'Material added successfully', id: result.insertId });
    });
});

// Endpoint untuk menambahkan application
app.post('/applications', (req, res) => {
    const { id_application, application_name } = req.body;
    const sql = 'INSERT INTO application (id_application, application_name) VALUES (?, ?)';
    db.query(sql, [id_application, application_name], (err, result) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json({ message: 'Application added successfully', id: result.insertId });
    });
});

//Endpoint untuk menambahkan input_material_requirement
app.post('/application_material_requirements', (req, res) => {
    const { id_application, materials } = req.body;

    if (!id_application || !Array.isArray(materials) || materials.length === 0) {
        return res.status(400).json({ error: 'Invalid input data' });
    }

    const materialIds = materials.map(material => material.id_material);
    const sql = 'SELECT id_material FROM material WHERE id_material IN (?)';
    db.query(sql, [materialIds], (err, results) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }

        const existingIds = results.map(row => row.id_material);
        const missingIds = materialIds.filter(id => !existingIds.includes(id));

        if (missingIds.length > 0) {
            return res.status(400).json({ error: `The following materials do not exist: ${missingIds.join(', ')}` });
        }

        const insertSql = 'INSERT INTO application_material_requirement (id_application, id_material, required_quantity) VALUES ?';
        const values = materials.map(material => [id_application, material.id_material, material.required_quantity]);

        db.query(insertSql, [values], (err, result) => {
            if (err) {
                return res.status(500).json({ error: err.message });
            }
            res.json({ message: 'Application requirements added successfully', affectedRows: result.affectedRows });
        });
    });
});

//Endpoint untuk menampilkan penggunaan material
app.get('/application_material_usage', async (req, res) => {
    try {
        const query = `
            SELECT amu.no_spk, a.application_name, amu.id_material, amu.used_quantity, amu.date_used
            FROM application_material_usage amu
            JOIN application a ON amu.id_application = a.id_application
        `;

        const [rows] = await db.promise().query(query);
        res.json(rows);
    } catch (error) {
        console.error("Error fetching usage data:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

// Endpoint untuk menambahkan penggunaan material
app.post('/application_material_usage', (req, res) => {
    const { id_application, no_spk, id_material, used_quantity } = req.body;

    // Validasi input
    if (!id_application ||!no_spk ||!id_material || !used_quantity) {
        return res.status(400).json({ error: 'Data input tidak valid' });
    }

    // Periksa apakah id_application dan id_material ada di database
    const checkSql = 'SELECT COUNT(*) AS count FROM application WHERE id_application = ?';
    db.query(checkSql, [id_application], (err, appResult) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        if (appResult[0].count === 0) {
            return res.status(400).json({ error: 'Aplikasi tidak ditemukan' });
        }

        const checkMaterialSql = 'SELECT COUNT(*) AS count FROM material WHERE id_material = ?';
        db.query(checkMaterialSql, [id_material], (err, matResult) => {
            if (err) {
                return res.status(500).json({ error: err.message });
            }
            if (matResult[0].count === 0) {
                return res.status(400).json({ error: 'Material tidak ditemukan' });
            }

            // Insert data ke tabel application_material_usage
            const insertSql = 'INSERT INTO application_material_usage (id_application, no_spk, id_material, used_quantity) VALUES (?, ?, ?, ?)';
            db.query(insertSql, [id_application, no_spk, id_material, used_quantity], (err, result) => {
                if (err) {
                    return res.status(500).json({ error: err.message });
                }
                res.json({ message: 'Penggunaan material berhasil ditambahkan', id_usage: result.insertId });
            });
        });
    });
});

// Endpoint untuk mengunduh laporan Excel
app.get('/download-report', async (req, res) => {
    try {
        // Ambil bulan dan tahun dari query parameter
        const { month, year } = req.query;

        if (!month || !year) {
            return res.status(400).json({ message: "Mohon masukkan bulan dan tahun." });
        }

        // Ambil data dari database berdasarkan bulan & tahun
        const [rows] = await db.promise().query(`
            SELECT amu.no_spk, a.application_name, amu.date_used 
            FROM application_material_usage amu
            JOIN application a ON amu.id_application = a.id_application
            WHERE MONTH(amu.date_used) = ? AND YEAR(amu.date_used) = ?
        `, [month, year]);

        if (rows.length === 0) {
            return res.status(404).json({ message: "Tidak ada data untuk bulan dan tahun tersebut." });
        }

        // Buat workbook Excel baru
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet(`Laporan ${month}-${year}`);

        // Header kolom
        worksheet.columns = [
            { header: 'No. SPK', key: 'no_spk', width: 20 },
            { header: 'Nama Aplikasi', key: 'application_name', width: 25 },
            { header: 'Tanggal Penggunaan', key: 'date_used', width: 20 }
        ];

        // Tambahkan data ke dalam worksheet
        rows.forEach(row => worksheet.addRow(row));

        // Konversi workbook ke Buffer
        const buffer = await workbook.xlsx.writeBuffer();

        // Set response headers
        res.setHeader('Content-Disposition', `attachment; filename="Laporan_${month}_${year}.xlsx"`);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

        // Kirim file Excel sebagai response
        res.send(buffer);
    } catch (error) {
        console.error("Gagal membuat laporan:", error);
        res.status(500).json({ message: "Terjadi kesalahan saat membuat laporan." });
    }
});


// Endpoint untuk menambahkan incoming material
app.post('/incoming_material', (req, res) => {
    const materials = req.body;

    if (!Array.isArray(materials) || materials.length === 0) {
        return res.status(400).json({ error: 'Data tidak lengkap' });
    }

    materials.forEach((material) => {
        const { id_material, material_name, stock, tanggal, quantity } = material;

        if (!id_material || !material_name || !stock || !tanggal || !quantity) {
            return res.status(400).json({ error: 'Data tidak lengkap' });
        }

        // Cek apakah id_material sudah ada di tabel material
        const checkMaterialSql = 'SELECT * FROM material WHERE id_material = ?';
        db.query(checkMaterialSql, [id_material], (err, result) => {
            if (err) {
                console.error('Gagal memeriksa data material:', err);
                return res.status(500).json({ error: 'Gagal memeriksa data material' });
            }

            if (result.length === 0) {
                // Jika id_material tidak ditemukan, tambahkan ke tabel material
                const insertMaterialSql = 'INSERT INTO material (id_material, material_name, stock, quantity) VALUES (?, ?, ?, ?)';
                db.query(insertMaterialSql, [id_material, material_name, stock, quantity], (err, result) => {
                    if (err) {
                        console.error('Gagal menambahkan data material:', err);
                        return res.status(500).json({ error: 'Gagal menambahkan data material' });
                    }
                    console.log('Data material berhasil ditambahkan');
                });
            } else {
                // Jika id_material ditemukan, perbarui stok di tabel material
                const updateMaterialSql = 'UPDATE material SET stock = stock + ? WHERE id_material = ?';
                db.query(updateMaterialSql, [stock, id_material], (err, result) => {
                    if (err) {
                        console.error('Gagal memperbarui stok material:', err);
                        return res.status(500).json({ error: 'Gagal memperbarui stok material' });
                    }
                    console.log('Stok material berhasil diperbarui');
                });
            }

            // Tambahkan data ke tabel incoming_material
            const insertIncomingSql = 'INSERT INTO incoming_material (id_material, material_name, quantity, tanggal) VALUES (?, ?, ?, ?)';
            db.query(insertIncomingSql, [id_material, material_name, stock, tanggal], (err, result) => {
                if (err) {
                    console.error('Gagal menambahkan data incoming material:', err);
                    return res.status(500).json({ error: 'Gagal menambahkan data incoming material' });
                }
                console.log('Data incoming material berhasil ditambahkan');
            });
        });
    });

    res.json({ message: 'Semua data incoming material berhasil diproses' });
});
// Rute untuk mendapatkan data material berdasarkan ID
app.get('/material/:id_material', (req, res) => {
    const { id_material } = req.params;

    const sql = 'SELECT * FROM material WHERE id_material = ?';
    db.query(sql, [id_material], (err, result) => {
        if (err) {
            console.error('Gagal mengambil data material:', err);
            return res.status(500).json({ error: 'Gagal mengambil data' });
        }
        if (result.length === 0) {
            return res.status(404).json({ error: 'Material tidak ditemukan' });
        }
        res.json(result[0]);
    });
});


// Endpoint untuk mendapatkan daftar material
app.get('/materials', (req, res) => {
    const sql = 'SELECT * FROM material';
    db.query(sql, (err, results) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json(results);
    });
});

// Endpoint untuk mendapatkan daftar application
app.get('/applications', (req, res) => {
    const sql = 'SELECT * FROM application';
    db.query(sql, (err, results) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json(results);
    });
});

// Endpoint untuk mendapatkan daftar application
app.get('/application_material_usage', (req, res) => {
    const sql = 'SELECT * FROM application_material_usage';
    db.query(sql, (err, results) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json(results);
    });
});

// Endpoint untuk mendapatkan daftar application
app.get('/application_material_requirement', (req, res) => {
    const sql = 'SELECT * FROM application_material_requirement';
    db.query(sql, (err, results) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json(results);
    });
});

const path = require('path');

// Sajikan file statis dari folder 'public'
app.use(express.static(path.join(__dirname, 'public')));

// Menjalankan server
const PORT = 8800;
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
