const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

// 32 Games with their verified cover image URLs
const games = [
  { id: "being-a-dik", title: "Being a DIK", url: "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/1261100/library_600x900.jpg" },
  { id: "leap-of-faith", title: "Leap of Faith", url: "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/2103450/library_600x900.jpg" },
  { id: "chasing-sunsets", title: "Chasing Sunsets", url: "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/1614040/library_600x900.jpg" },
  { id: "city-of-broken-dreamers", title: "City of Broken Dreamers", url: "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/1195670/library_600x900.jpg" },
  { id: "once-upon-a-time-in-asia", title: "Once Upon a Time in Asia", url: "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/2051210/library_600x900.jpg" },
  { id: "eternum", title: "Eternum", url: "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/2273070/library_600x900.jpg" },
  { id: "once-in-a-lifetime", title: "Once in a Lifetime", url: "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/1499590/library_600x900.jpg" },
  { id: "freshwomen", title: "FreshWomen", url: "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/1350650/library_600x900.jpg" },
  { id: "lust-academy", title: "Lust Academy", url: "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/1815120/library_600x900.jpg" },
  { id: "man-of-the-house", title: "Man of the House", url: "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/921750/library_600x900.jpg" },
  { id: "harem-hotel", title: "Harem Hotel", url: "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/1805720/library_600x900.jpg" },
  { id: "college-kings", title: "College Kings", url: "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/1463120/library_600x900.jpg" },
  { id: "sisterly-lust", title: "Sisterly Lust", url: "https://s2.vndb.org/cv/64/18664.jpg" },
  { id: "melody", title: "Melody", url: "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/1444150/library_600x900.jpg" },
  { id: "double-homework", title: "Double Homework", url: "https://s2.vndb.org/cv/02/29402.jpg" },
  { id: "the-headmaster", title: "The Headmaster", url: "https://s2.vndb.org/cv/26/25126.jpg" },
  { id: "acting-lessons", title: "Acting Lessons", url: "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/1004170/library_600x900.jpg" },
  { id: "milfy-city", title: "Milfy City", url: "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/2635950/library_600x900.jpg" },
  { id: "summer-memories", title: "Summer Memories", url: "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/1220470/library_600x900.jpg" },
  { id: "love-season", title: "Love Season", url: "https://s2.vndb.org/cv/66/31566.jpg" },
  { id: "genesis", title: "Genesis", url: "https://s2.vndb.org/cv/27/31627.jpg" },
  { id: "my-cute-cousin", title: "My Cute Cousin", url: "https://s2.vndb.org/cv/28/21528.jpg" },
  { id: "depraved-town", title: "Depraved Town", url: "https://s2.vndb.org/cv/02/30702.jpg" },
  { id: "doki-doki", title: "Doki Doki Literature Club!", url: "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/698780/library_600x900.jpg" },
  { id: "katawa-shoujo", title: "Katawa Shoujo", url: "https://s2.vndb.org/cv/03/2103.jpg" },
  { id: "a-town-uncovered", title: "A Town Uncovered", url: "https://s2.vndb.org/cv/03/21503.jpg" },
  { id: "corrupted-kingdoms", title: "Corrupted Kingdoms", url: "https://s2.vndb.org/cv/28/25828.jpg" },
  { id: "dreams-of-desire", title: "Dreams of Desire", url: "https://s2.vndb.org/cv/88/20088.jpg" },
  { id: "the-evolution-of-trust", title: "The Evolution of Trust", url: "https://ncase.me/trust/social/thumbnail.png" },
  { id: "robin-hood", title: "Robin Hood: Sherwood Girls", url: "https://s2.vndb.org/cv/15/33215.jpg" },
  { id: "acting-lessons-2", title: "Chasing Shadows", url: "https://s2.vndb.org/cv/29/31629.jpg" },
  { id: "once-more", title: "Once More", url: "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/2051210/library_600x900.jpg" }
];

const destDir = path.join(__dirname, 'public', 'covers');

// Ensure destination folder exists
if (!fs.existsSync(destDir)) {
  fs.mkdirSync(destDir, { recursive: true });
  console.log(`Created directory: ${destDir}`);
}

// Download function that handles HTTP/HTTPS and follows redirects
function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    
    const requestOptions = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://www.google.com/' // Bypass referer checks
      }
    };

    const get = url.startsWith('https') ? https.get : http.get;
    
    const request = get(url, requestOptions, (response) => {
      // Handle redirects (status code 3xx)
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        file.close();
        fs.unlinkSync(destPath); // Delete empty file
        // Follow redirect recursively
        return downloadFile(response.headers.location, destPath).then(resolve).catch(reject);
      }

      if (response.statusCode !== 200) {
        file.close();
        fs.unlinkSync(destPath); // Delete empty file
        reject(new Error(`Failed to download. Status Code: ${response.statusCode}`));
        return;
      }

      response.pipe(file);
      
      file.on('finish', () => {
        file.close();
        resolve();
      });
    });

    request.on('error', (err) => {
      file.close();
      if (fs.existsSync(destPath)) {
        fs.unlinkSync(destPath);
      }
      reject(err);
    });
    
    // Set a timeout to prevent hanging downloads
    request.setTimeout(12000, () => {
      request.destroy();
      file.close();
      if (fs.existsSync(destPath)) {
        fs.unlinkSync(destPath);
      }
      reject(new Error('Request timed out'));
    });
  });
}

// Main runner
async function downloadAll() {
  console.log(`Starting download of ${games.length} game covers...`);
  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < games.length; i++) {
    const game = games[i];
    const filename = `${game.id}.jpg`;
    const destPath = path.join(destDir, filename);

    console.log(`[${i + 1}/${games.length}] Downloading cover for "${game.title}"...`);
    
    try {
      await downloadFile(game.url, destPath);
      console.log(`   └─ Success! Saved to public/covers/${filename}`);
      successCount++;
    } catch (err) {
      console.error(`   └─ Error downloading "${game.title}": ${err.message}`);
      failCount++;
    }
    
    // Delay 150ms between requests to be polite to the CDNs
    await new Promise(r => setTimeout(r, 150));
  }

  console.log(`\nDownload completed:`);
  console.log(`- Total Games: ${games.length}`);
  console.log(`- Successfully Downloaded: ${successCount}`);
  console.log(`- Failed: ${failCount}`);
}

downloadAll();
