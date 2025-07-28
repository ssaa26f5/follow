// server.js

// 1. استدعاء المكتبات
require('dotenv').config(); // لتحميل المتغيرات من ملف .env
const express = require('express');
const multer = require('multer');
const xlsx = require('xlsx');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// 2. إعداد Express App
const app = express();
const port = 8080 || process.env.PORT;
app.set('views', path.join(__dirname, 'views'));

app.set('view engine', 'ejs'); // تحديد EJS كمحرك قوالب
app.use(express.urlencoded({ extended: true })); // لقراءة البيانات من الفورم
app.use(express.static(path.join(__dirname, 'public'))); // لخدمة الملفات الثابتة

// 3. إعداد Multer لتخزين الملف المرفوع في الذاكرة مؤقتاً
const upload = multer({ storage: multer.memoryStorage() });

// 4. الاتصال بقاعدة البيانات (أو إنشائها إذا لم تكن موجودة)
const db = new sqlite3.Database(path.join(__dirname, 'database.db'), sqlite3.OPEN_READONLY, (err) => {

    if (err) {
        console.error("Error opening database " + err.message);
    } else {
        console.log("Database connected!");
        // إنشاء الجدول عند بدء تشغيل الخادم إذا لم يكن موجودًا
        db.run(`
            CREATE TABLE IF NOT EXISTS students (
                student_id TEXT,
                student_name TEXT,
                unique_code TEXT PRIMARY KEY,
                data TEXT
            )
        `);
    }
});

// Route لعرض صفحة الرفع
app.get('/upload', (req, res) => {
    res.render('upload');
});

// server.js - (استبدل الدالة القديمة بهذه النسخة المصححة)

app.post('/upload', upload.single('sheet'), (req, res) => {
    const { password } = req.body;

    if (password !== process.env.UPLOAD_PASSWORD) {
        return res.status(401).render('upload', { error: 'كلمة السر غير صحيحة!' });
    }
    if (!req.file) {
        return res.status(400).render('upload', { error: 'الرجاء رفع ملف إكسل.' });
    }

    try {
        const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const data = xlsx.utils.sheet_to_json(sheet, { header: 1 });

        // التحقق من وجود بيانات ورأس جدول
        if (!data || data.length < 2) {
            return res.render('upload', { error: 'الملف فارغ أو لا يحتوي على صفوف بيانات.' });
        }

        const headerRow = data[0];
        const studentRows = data.slice(1);

        const studentsToInsert = studentRows.map(row => {
            // تجاهل الصفوف الفارغة تماماً
            if (row.length === 0) return null;

            const studentData = { sessions: [], exams: {} };
            const uniqueCodeIndex = headerRow.length - 1;
            const unique_code = row[uniqueCodeIndex];

            if (!unique_code) return null; // تجاهل أي صف بدون كود مميز

            headerRow.forEach((header, index) => {
                // التأكد من أن الـ header ليس فارغاً قبل استخدامه
                if (header) { 
                    const value = row[index] !== undefined ? row[index] : null;

                    if (header.includes("درجة امتحان حصة")) {
                        const match = header.match(/\d+/);
                        if (match) {
                            const sessionNumber = parseInt(match[0], 10);
                            while (studentData.sessions.length < sessionNumber) studentData.sessions.push({ grade: null, attendance: null });
                            studentData.sessions[sessionNumber - 1].grade = value;
                        }
                    } else if (header.includes("حضور حصة")) {
                        const match = header.match(/\d+/);
                        if (match) {
                            const sessionNumber = parseInt(match[0], 10);
                            while (studentData.sessions.length < sessionNumber) studentData.sessions.push({ grade: null, attendance: null });
                            studentData.sessions[sessionNumber - 1].attendance = value;
                        }
                    } else if (header.includes("امتحان") || header.includes("مراجعة")) {
                        studentData.exams[header] = value;
                    }
                }
            });

            return {
                student_id: row[0],
                student_name: row[1],
                unique_code: unique_code,
                data: JSON.stringify(studentData)
            };
        }).filter(s => s !== null);

        if (studentsToInsert.length === 0) {
            return res.render('upload', { error: 'لم يتم العثور على طلاب لديهم كود مميز في الملف.' });
        }

        db.serialize(() => {
            db.run("DELETE FROM students", err => { if (err) throw err; });
            const stmt = db.prepare("INSERT INTO students (student_id, student_name, unique_code, data) VALUES (?, ?, ?, ?)");
            studentsToInsert.forEach(student => {
                stmt.run(student.student_id, student.student_name, student.unique_code, student.data);
            });
            stmt.finalize(err => {
                if (err) throw err;
                console.log(`${studentsToInsert.length} students inserted successfully.`);
                res.render('upload', { success: `تم رفع ومعالجة بيانات ${studentsToInsert.length} طالب بنجاح!` });
            });
        });

    } catch (error) {
        // هذا هو الجزء الأهم الآن! سيطبع الخطأ الفعلي في الـ terminal
        console.error("!!! Critical Error during file processing:", error);
        res.status(500).render('upload', { error: 'حدث خطأ أثناء معالجة الملف. تأكد من أن صيغة الملف صحيحة.' });
    }
});

// Route جديد لعرض صفحة المسح
app.get('/info', (req, res) => {
    // هذا المسار يعرض الصفحة التي تحتوي على كاميرا المسح
    res.render('scan'); 
});

// server.js
app.get('/info/:code', (req, res) => {
    const uniqueCode = req.params.code;
    
    // سطر جديد للتحقق
    console.log(`Searching for student with code: [${uniqueCode}]`);

    db.get("SELECT * FROM students WHERE unique_code = ?", [uniqueCode], (err, row) => {
        // ... باقي الكود كما هو
        if (err) {
            return res.status(500).render('error', { message: 'حدث خطأ في الخادم.' });
        }
        if (!row) {
            // اطبع رسالة أوضح في الـ console
            console.log(`Student with code [${uniqueCode}] NOT FOUND in database.`);
            return res.status(404).render('error', { message: 'هذا الكود غير صحيح أو الطالب غير موجود.' });
        }
        // ... باقي الكود
        const studentData = JSON.parse(row.data);
        res.render('student-info', {
            student: { student_id: row.student_id, student_name: row.student_name },
            data: studentData
        });
    });
});

// 5. تشغيل الخادم
app.listen(port, () => {
    console.log(`Server is running at http://localhost:${port}`);
});

app.get('/', (req, res) => {
  res.redirect('/upload'); // أو res.render('upload');
});
