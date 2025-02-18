const http = require('http');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const crypto = require('crypto');
const QRCode = require('qrcode');

// Statik dosyaların bulunduğu dizin
const STATIC_DIR = __dirname;

// MongoDB bağlantı URL'i
const mongoURL = 'mongodb://localhost:27017/biletDB';

// MongoDB bağlantı kontrolü
mongoose.connect(mongoURL, {
    useNewUrlParser: true,
    useUnifiedTopology: true
})
.then(() => {
    console.log('MongoDB\'ye başarıyla bağlandı');
    // Test için bir koleksiyon oluşturalım
    return Rezervasyon.countDocuments();
})
.then(count => {
    console.log(`Mevcut rezervasyon sayısı: ${count}`);
})
.catch(err => {
    console.error('MongoDB bağlantı hatası:', err);
    process.exit(1); // Hata durumunda uygulamayı sonlandır
});

// Rezervasyon şeması
const rezervasyonSchema = new mongoose.Schema({
    koltukId: String,         // "Giriş Bölümü-Sahneye yakın bölüm-1-1" formatında
    bolum: String,            // "Giriş Bölümü", "Orta Bölüm", "Son Bölüm"
    altBolum: String,         // "Sahneye yakın bölüm", "Bir Arkası" vs.
    siraNo: Number,           // Sıra numarası
    koltukNo: Number,         // Koltuk numarası
    adSoyad: String,          // Rezervasyon yapan kişinin adı soyadı
    email: String,            // @iletisim.gov.tr uzantılı email
    qrCode: String,           // QR kod URL'i için yeni alan
    onayDurumu: { 
        type: String, 
        enum: ['Onaylanmadı', 'Onaylandı'], 
        default: 'Onaylanmadı' 
    },
    tarih: { 
        type: Date, 
        default: Date.now 
    }
});

const Rezervasyon = mongoose.model('Rezervasyon', rezervasyonSchema);

// Basit bir token üretme fonksiyonu
function generateToken() {
    return crypto.randomBytes(32).toString('hex');
}

// Aktif tokenları tutacağımız set
const activeTokens = new Set();

// Türkçe karakterleri düzeltme fonksiyonu
function turkceKarakterleriDuzelt(text) {
    if (!text) return ''; // text undefined veya null ise boş string döndür
    
    return String(text)  // text'i string'e çevir
        .replace(/ğ/g, 'g').replace(/Ğ/g, 'G')
        .replace(/ü/g, 'u').replace(/Ü/g, 'U')
        .replace(/ş/g, 's').replace(/Ş/g, 'S')
        .replace(/ı/g, 'i').replace(/İ/g, 'I')
        .replace(/ö/g, 'o').replace(/Ö/g, 'O')
        .replace(/ç/g, 'c').replace(/Ç/g, 'C');
}

const server = http.createServer(async (req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    // OPTIONS request için yanıt
    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    // URL'i parse et
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;

    // Admin sayfası için özel yönlendirme
    if (pathname === '/admin') {
        try {
            const content = await fs.promises.readFile(path.join(STATIC_DIR, 'admin.html'));
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(content);
        } catch (error) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Admin sayfası yüklenemedi' }));
        }
        return;
    }

    // API endpoint'leri için Content-Type
    if (pathname.startsWith('/api/')) {
        res.setHeader('Content-Type', 'application/json');

        if (pathname === '/api/rezervasyon' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => {
                body += chunk.toString();
            });
            
            req.on('end', async () => {
                try {
                    const data = JSON.parse(body);
                    console.log('Gelen rezervasyon verisi:', data);
                    
                    // Benzersiz bir rezervasyon kodu oluştur
                    const rezervasyonKodu = crypto.randomBytes(8).toString('hex');
                    const qrUrl = `http://localhost:3000/dogrula/${rezervasyonKodu}`;
                    
                    // QR kod oluştur
                    const qrImage = await QRCode.toDataURL(qrUrl);
                    
                    // Logo dosyasını oku
                    const logoPath = path.join(STATIC_DIR, 'logo.svg');
                    const logoContent = await fs.promises.readFile(logoPath, 'utf8');

                    // Bilet HTML'inde koltuk ve bölüm bilgilerini düzelt
                    const koltukBilgisi = turkceKarakterleriDuzelt(data.koltukNo);
                    const bolumBilgisi = data.koltukNo ? data.koltukNo.split('-') : ['', ''];
                    const bolumAdi = turkceKarakterleriDuzelt(bolumBilgisi[0] || '');
                    const altBolumAdi = turkceKarakterleriDuzelt(bolumBilgisi[1] || '');

                    // Diğer verileri de güvenli hale getirelim
                    const adSoyad = turkceKarakterleriDuzelt(data.adSoyad || '');
                    const email = data.email || '';

                    // HTML bilet şablonu
                    const biletHTML = `
                        <!DOCTYPE html>
                        <html>
                        <head>
                            <meta charset="UTF-8">
                            <title>Etkinlik Bileti</title>
                            <style>
                                body {
                                    font-family: Arial, sans-serif;
                                    padding: 20px;
                                    max-width: 800px;
                                    margin: 0 auto;
                                }
                                .bilet {
                                    border: 2px solid #333;
                                    padding: 20px;
                                    border-radius: 10px;
                                    margin-bottom: 20px;
                                }
                                .baslik {
                                    text-align: center;
                                    margin-bottom: 20px;
                                }
                                .baslik h1 {
                                    color: #2c3e50;
                                    margin-bottom: 5px;
                                }
                                .baslik h2 {
                                    color: #34495e;
                                    margin-top: 0;
                                }
                                .bilgi-satir {
                                    margin: 10px 0;
                                }
                                .qr-bolum {
                                    text-align: center;
                                    margin: 20px 0;
                                }
                                .qr-bolum img {
                                    max-width: 200px;
                                }
                                .qr-aciklama {
                                    color: #666;
                                    font-size: 14px;
                                    margin-top: 10px;
                                }
                                .etkinlik-detay {
                                    text-align: center;
                                    margin-top: 20px;
                                    color: #34495e;
                                }
                                .butonlar {
                                    text-align: center;
                                    margin-top: 20px;
                                    display: flex;
                                    justify-content: center;
                                    gap: 10px;
                                }
                                .buton {
                                    padding: 10px 20px;
                                    border: none;
                                    border-radius: 5px;
                                    cursor: pointer;
                                    display: inline-flex;
                                    align-items: center;
                                    gap: 5px;
                                    text-decoration: none;
                                    font-size: 14px;
                                }
                                .yazdir {
                                    background-color: #28a745;
                                    color: white;
                                }
                                .pdf {
                                    background-color: #dc3545;
                                    color: white;
                                }
                                @media print {
                                    .butonlar {
                                        display: none !important;
                                    }
                                }
                            </style>
                        </head>
                        <body>
                            <div class="bilet">
                                <div class="baslik">
                                    <h1>ETKINLIK BILETI</h1>
                                    <h2>T.C. ILETISIM BASKANLIGI</h2>
                                </div>
                                
                                <div class="bilgi-satir">
                                    <strong>Ad Soyad:</strong> ${adSoyad}
                                </div>
                                
                                <div class="bilgi-satir">
                                    <strong>E-posta:</strong> ${email}
                                </div>
                                
                                <div class="bilgi-satir">
                                    <strong>Koltuk:</strong> ${koltukBilgisi}
                                </div>
                                
                                <div class="bilgi-satir">
                                    <strong>Bolum:</strong> ${bolumAdi} - ${altBolumAdi}
                                </div>
                                
                                <div class="qr-bolum">
                                    <h3>QR Kod</h3>
                                    <img src="${qrImage}" alt="QR Kod">
                                    <div class="qr-aciklama">
                                        Bu QR kodu etkinlik girisinde gosteriniz
                                    </div>
                                </div>
                                
                                <div class="etkinlik-detay">
                                    <div><strong>Etkinlik Yeri:</strong> T.C. ILETISIM BASKANLIGI Konferans Salonu</div>
                                    <div><strong>Tarih:</strong> ${new Date().toLocaleDateString('tr-TR', {
                                        year: 'numeric',
                                        month: 'long',
                                        day: 'numeric',
                                        weekday: 'long'
                                    }).replace(/ğ/g, 'g').replace(/Ğ/g, 'G')
                                      .replace(/ü/g, 'u').replace(/Ü/g, 'U')
                                      .replace(/ş/g, 's').replace(/Ş/g, 'S')
                                      .replace(/ı/g, 'i').replace(/İ/g, 'I')
                                      .replace(/ö/g, 'o').replace(/Ö/g, 'O')
                                      .replace(/ç/g, 'c').replace(/Ç/g, 'C')}</div>
                                </div>
                            </div>

                            <div class="butonlar">
                                <button onclick="window.print()" class="buton yazdir">
                                    <svg width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
                                        <path d="M2.5 8a.5.5 0 1 0 0-1 .5.5 0 0 0 0 1z"/>
                                        <path d="M5 1a2 2 0 0 0-2 2v2H2a2 2 0 0 0-2 2v3a2 2 0 0 0 2 2h1v1a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2v-1h1a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-1V3a2 2 0 0 0-2-2H5zM4 3a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2H4V3zm1 5a2 2 0 0 0-2 2v1H2a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-1v-1a2 2 0 0 0-2-2H5zm7 2v3a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1z"/>
                                    </svg>
                                    Yazdir
                                </button>
                                <button onclick="window.print()" class="buton pdf">
                                    <svg width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
                                        <path d="M4 0h8a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V2a2 2 0 0 1 2-2zm0 1a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1H4z"/>
                                        <path d="M4.603 12.087a.81.81 0 0 1-.438-.42c-.195-.388-.13-.776.08-1.102.198-.307.526-.568.897-.787a7.68 7.68 0 0 1 1.482-.645 19.701 19.701 0 0 0 1.062-2.227 7.269 7.269 0 0 1-.43-1.295c-.086-.4-.119-.796-.046-1.136.075-.354.274-.672.65-.823.192-.077.4-.12.602-.077a.7.7 0 0 1 .477.365c.088.164.12.356.127.538.007.187-.012.395-.047.614-.084.51-.27 1.134-.52 1.794a10.954 10.954 0 0 0 .98 1.686 5.753 5.753 0 0 1 1.334.05c.364.065.734.195.96.465.12.144.193.32.2.518.007.192-.047.382-.138.563a1.04 1.04 0 0 1-.354.416.856.856 0 0 1-.51.138c-.331-.014-.654-.196-.933-.417a5.716 5.716 0 0 1-.911-.95 11.642 11.642 0 0 0-1.997.406 11.311 11.311 0 0 1-1.021 1.51c-.29.35-.608.655-.926.787a.793.793 0 0 1-.58.029zm1.379-1.901c-.166.076-.32.156-.459.238-.328.194-.541.383-.647.547-.094.145-.096.25-.04.361.01.022.02.036.026.044a.27.27 0 0 0 .035-.012c.137-.056.355-.235.635-.572a8.18 8.18 0 0 0 .45-.606zm1.64-1.33a12.647 12.647 0 0 1 1.01-.193 11.666 11.666 0 0 1-.51-.858 20.741 20.741 0 0 1-.5 1.05zm2.446.45c.15.162.296.3.435.41.24.19.407.253.498.256a.107.107 0 0 0 .07-.015.307.307 0 0 0 .094-.125.436.436 0 0 0 .059-.2.095.095 0 0 0-.026-.063c-.052-.062-.2-.152-.518-.209a3.881 3.881 0 0 0-.612-.053zM8.078 5.8a6.7 6.7 0 0 0 .2-.828c.031-.188.043-.343.038-.465a.613.613 0 0 0-.032-.198.517.517 0 0 0-.145.04c-.087.035-.158.106-.196.283-.04.192-.03.469.046.822.024.111.054.227.09.346z"/>
                                    </svg>
                                    PDF Olarak Kaydet
                                </button>
                            </div>

                            <script>
                                // PDF kaydetme fonksiyonu
                                document.querySelector('.pdf').addEventListener('click', function() {
                                    window.print();
                                });
                            </script>
                        </body>
                        </html>
                    `;

                    // Base64'e çevir
                    const biletBase64 = Buffer.from(biletHTML, 'utf8').toString('base64');

                    const yeniRezervasyon = new Rezervasyon({
                        koltukId: data.koltukNo,
                        bolum: data.koltukNo.split('-')[0],
                        altBolum: data.koltukNo.split('-')[1],
                        siraNo: parseInt(data.koltukNo.split('-')[2]),
                        koltukNo: parseInt(data.koltukNo.split('-')[3]),
                        adSoyad: adSoyad,
                        email: email,
                        qrCode: rezervasyonKodu
                    });

                    const kaydedilenRezervasyon = await yeniRezervasyon.save();

                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ 
                        message: 'Rezervasyon başarılı',
                        rezervasyon: kaydedilenRezervasyon,
                        bilet: biletBase64
                    }));
                } catch (error) {
                    console.error('Rezervasyon hatası:', error);
                    res.writeHead(500);
                    res.end(JSON.stringify({ 
                        error: 'Rezervasyon yapılırken bir hata oluştu',
                        details: error.message
                    }));
                }
            });
        } 
        else if (pathname === '/api/rezervasyonlar' && req.method === 'GET') {
            try {
                const rezervasyonlar = await Rezervasyon.find().sort({ tarih: -1 });
                console.log('Rezervasyonlar bulundu:', rezervasyonlar.length); // Debug için
                
                if (!rezervasyonlar) {
                    throw new Error('Rezervasyonlar bulunamadı');
                }
                
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(rezervasyonlar));
            } catch (error) {
                console.error('Rezervasyonlar listelenirken hata:', error);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ 
                    error: 'Rezervasyonlar alınırken hata oluştu',
                    details: error.message 
                }));
            }
        }
        else if (pathname.match(/^\/api\/rezervasyon\/[^/]+$/) && req.method === 'DELETE') {
            const id = pathname.split('/').pop();
            try {
                await Rezervasyon.findByIdAndDelete(id);
                res.writeHead(200);
                res.end(JSON.stringify({ message: 'Rezervasyon silindi' }));
            } catch (error) {
                res.writeHead(500);
                res.end(JSON.stringify({ error: 'Silme işlemi başarısız' }));
            }
        }
        else if (pathname.match(/^\/api\/rezervasyon\/[^/]+$/) && req.method === 'GET') {
            const id = pathname.split('/').pop();
            try {
                const rezervasyon = await Rezervasyon.findById(id);
                if (!rezervasyon) {
                    res.writeHead(404);
                    res.end(JSON.stringify({ error: 'Rezervasyon bulunamadı' }));
                    return;
                }
                res.writeHead(200);
                res.end(JSON.stringify(rezervasyon));
            } catch (error) {
                res.writeHead(500);
                res.end(JSON.stringify({ error: 'Rezervasyon bilgileri alınamadı' }));
            }
        }
        else if (pathname.match(/^\/api\/rezervasyon\/[^/]+$/) && req.method === 'PUT') {
            const id = pathname.split('/').pop();
            let body = '';
            req.on('data', chunk => {
                body += chunk.toString();
            });
            
            req.on('end', async () => {
                try {
                    const data = JSON.parse(body);
                    const rezervasyon = await Rezervasyon.findByIdAndUpdate(
                        id,
                        { $set: data },
                        { new: true }
                    );
                    if (!rezervasyon) {
                        res.writeHead(404);
                        res.end(JSON.stringify({ error: 'Rezervasyon bulunamadı' }));
                        return;
                    }
                    res.writeHead(200);
                    res.end(JSON.stringify(rezervasyon));
                } catch (error) {
                    res.writeHead(500);
                    res.end(JSON.stringify({ error: 'Güncelleme başarısız' }));
                }
            });
        }
    }
    // QR kod doğrulama endpoint'i
    else if (pathname.startsWith('/dogrula/')) {
        const rezervasyonKodu = pathname.split('/').pop();
        try {
            console.log('Aranan rezervasyon kodu:', rezervasyonKodu);

            // Tam eşleşme arayalım, regex kullanmayalım
            const rezervasyon = await Rezervasyon.findOne({
                qrCode: rezervasyonKodu
            });
            
            console.log('Bulunan rezervasyon:', rezervasyon);

            if (rezervasyon) {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ 
                    valid: true, 
                    rezervasyon: {
                        _id: rezervasyon._id,
                        adSoyad: rezervasyon.adSoyad,
                        koltuk: `${rezervasyon.bolum} - ${rezervasyon.siraNo}-${rezervasyon.koltukNo}`,
                        tarih: rezervasyon.tarih,
                        onayDurumu: rezervasyon.onayDurumu
                    }
                }));
            } else {
                console.log('Rezervasyon bulunamadı. Aranan kod:', rezervasyonKodu);
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ 
                    valid: false, 
                    error: 'Geçersiz rezervasyon kodu',
                    searchedCode: rezervasyonKodu
                }));
            }
        } catch (error) {
            console.error('Doğrulama hatası:', error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ 
                valid: false, 
                error: 'Doğrulama işlemi başarısız',
                details: error.message
            }));
        }
    }
    // Doğrulama sayfası için endpoint
    else if (pathname === '/dogrulama') {
        try {
            console.log('Doğrulama sayfası istendi');
            console.log('Dosya yolu:', path.join(STATIC_DIR, 'dogrulama.html'));
            const content = await fs.promises.readFile(path.join(STATIC_DIR, 'dogrulama.html'));
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(content);
        } catch (error) {
            console.error('Doğrulama sayfası yükleme hatası:', error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ 
                error: 'Doğrulama sayfası yüklenemedi',
                details: error.message 
            }));
        }
    }
    // Rezervasyon onaylama endpoint'i
    else if (pathname.match(/^\/api\/rezervasyon\/[^/]+\/onay$/) && req.method === 'POST') {
        const id = pathname.split('/')[3];
        console.log('Onaylama isteği alındı:', id);
        
        // CORS headers ekle
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');

        // OPTIONS isteğini yanıtla
        if (req.method === 'OPTIONS') {
            res.writeHead(200);
            res.end();
            return;
        }

        try {
            // ID kontrolü
            if (!id || !mongoose.Types.ObjectId.isValid(id)) {
                throw new Error('Geçersiz rezervasyon ID');
            }

            // Rezervasyonu güncelle
            const rezervasyon = await Rezervasyon.findByIdAndUpdate(
                id,
                { $set: { onayDurumu: 'Onaylandı' } },
                { new: true }
            );

            if (!rezervasyon) {
                throw new Error('Rezervasyon bulunamadı');
            }

            console.log('Rezervasyon güncellendi:', rezervasyon);
            
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ 
                message: 'Rezervasyon başarıyla onaylandı',
                rezervasyon 
            }));

        } catch (error) {
            console.error('Onaylama hatası:', error.message);
            const statusCode = error.message.includes('bulunamadı') ? 404 : 400;
            
            res.writeHead(statusCode, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ 
                error: 'Onaylama işlemi başarısız',
                details: error.message
            }));
        }
    }
    // Statik dosyalar için
    else {
        try {
            let filePath;
            if (pathname === '/' || pathname === '/index.html') {
                filePath = path.join(STATIC_DIR, 'index.html');
            } else {
                filePath = path.join(STATIC_DIR, pathname);
            }

            const content = await fs.promises.readFile(filePath);
            
            // Content-Type'ı dosya uzantısına göre belirle
            const ext = path.extname(filePath);
            let contentType = 'text/plain';
            
            switch (ext) {
                case '.html':
                    contentType = 'text/html';
                    break;
                case '.css':
                    contentType = 'text/css';
                    break;
                case '.js':
                    contentType = 'text/javascript';
                    break;
                case '.json':
                    contentType = 'application/json';
                    break;
            }

            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content);
        } catch (error) {
            console.error('Dosya okuma hatası:', error);
            if (error.code === 'ENOENT') {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Dosya bulunamadı' }));
            } else {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Sunucu hatası' }));
            }
        }
    }
});

// Port numarasını değişkenle tanımlayalım
const PORT = process.env.PORT || 3000; // 3000 veya başka bir port numarası

server.listen(PORT, () => {
    console.log(`Sunucu http://localhost:${PORT} adresinde çalışıyor`);
    console.log('Statik dosyalar:', STATIC_DIR);
}); 