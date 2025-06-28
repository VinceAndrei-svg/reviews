const express = require("express")
const router = express.Router()
const db = require("../config/db")
const sessionAuth = require("../middleware/sessionAuth")
const roleAuth = require("../middleware/roleAuth")

// Add error logging middleware
router.use((req, res, next) => {
  console.log(`🔍 Provider route: ${req.method} ${req.path}`)
  console.log(`👤 User:`, req.session.user?.username, req.session.user?.user_type)
  next()
})

// Entry Provider Dashboard - USING 'picture' COLUMN DIRECTLY
router.get("/entry", sessionAuth, roleAuth(["entry_provider"]), async (req, res) => {
  try {
    console.log("✅ Entry dashboard accessed by:", req.session.user.username)

    // Get today's date
    const today = new Date().toISOString().split("T")[0]
    console.log("📅 Today's date:", today)

    // Get all tourists with PICTURE column directly
    const [tourists] = await db.query(
      `SELECT 
        t.tourist_id,
        t.first_name,
        t.last_name, 
        t.email,
        t.phone,
        t.nationality,
        t.picture,
        t.arrival_date,
        t.departure_date,
        t.verified_at,
        t.created_at
      FROM tourists t 
      ORDER BY t.created_at DESC 
      LIMIT 50`,
    )

    console.log("👥 Found tourists:", tourists.length)

    // Log picture information for debugging
    const touristsWithPictures = tourists.filter((t) => t.picture && t.picture !== "default.jpg")
    console.log("📸 Tourists with pictures:", touristsWithPictures.length)

    if (touristsWithPictures.length > 0) {
      console.log(
        "📸 Sample picture paths:",
        touristsWithPictures.slice(0, 3).map((t) => ({
          name: `${t.first_name} ${t.last_name}`,
          picture: t.picture,
        })),
      )
    }

    // Simple stats calculation
    const stats = {
      total_today: tourists.filter((t) => {
        const arrivalDate = new Date(t.arrival_date).toISOString().split("T")[0]
        return arrivalDate === today
      }).length,
      verified: tourists.filter((t) => t.verified_at).length,
      pending: tourists.filter((t) => !t.verified_at).length,
      expired: tourists.filter((t) => {
        const departureDate = new Date(t.departure_date)
        return departureDate < new Date()
      }).length,
    }

    console.log("📊 Stats:", stats)

    // Render the dashboard
    res.render("provider/entry-dashboard", {
      title: "Entry Provider Dashboard",
      tourists: tourists,
      stats: stats,
      user: req.session.user,
    })
  } catch (error) {
    console.error("❌ Entry dashboard error:", error.message)
    console.error("📍 Error stack:", error.stack)

    // Send detailed error for debugging
    res.status(500).send(`
      <h1>Entry Dashboard Error</h1>
      <p><strong>Error:</strong> ${error.message}</p>
      <p><strong>User:</strong> ${req.session.user?.username}</p>
      <p><strong>User Type:</strong> ${req.session.user?.user_type}</p>
      <pre>${error.stack}</pre>
    `)
  }
})

// Verify Tourist Entry
router.post("/entry/verify/:touristId", sessionAuth, roleAuth(["entry_provider"]), async (req, res) => {
  try {
    const { touristId } = req.params
    console.log("✅ Verifying tourist:", touristId)

    await db.query(
      `UPDATE tourists 
       SET verified_at = NOW() 
       WHERE tourist_id = ?`,
      [touristId],
    )

    res.json({
      success: true,
      message: "Tourist verified successfully",
    })
  } catch (error) {
    console.error("❌ Verification error:", error)
    res.status(500).json({
      success: false,
      message: "Verification failed: " + error.message,
    })
  }
})

// Search Tourists - USING 'picture' COLUMN DIRECTLY
router.get("/entry/search", sessionAuth, roleAuth(["entry_provider"]), async (req, res) => {
  try {
    const { q } = req.query
    console.log("🔍 Searching for:", q)

    const [tourists] = await db.query(
      `SELECT 
        tourist_id,
        first_name,
        last_name,
        email,
        phone,
        picture,
        verified_at
      FROM tourists 
      WHERE first_name LIKE ? OR last_name LIKE ? OR email LIKE ?
      ORDER BY created_at DESC
      LIMIT 20`,
      [`%${q}%`, `%${q}%`, `%${q}%`],
    )

    console.log("📋 Search results:", tourists.length)
    console.log(
      "📸 Search results with pictures:",
      tourists.filter((t) => t.picture && t.picture !== "default.jpg").length,
    )
    res.json({ tourists })
  } catch (error) {
    console.error("❌ Search error:", error)
    res.status(500).json({
      success: false,
      message: "Search failed: " + error.message,
    })
  }
})

// Get Tourist by QR Code - USING 'picture' COLUMN DIRECTLY
router.post("/entry/scan-qr", sessionAuth, roleAuth(["entry_provider"]), async (req, res) => {
  try {
    const { qrData } = req.body
    console.log("🔍 QR scan request:", qrData)

    // Extract information from QR text format
    const touristInfo = extractTouristInfoFromQR(qrData)
    console.log("🎯 Extracted tourist info:", touristInfo)

    if (!touristInfo) {
      return res.status(400).json({
        success: false,
        message: "Could not extract tourist information from QR code",
      })
    }

    // Search for tourist by name and phone - INCLUDING EXISTING PICTURES FROM 'picture' COLUMN
    let query = `SELECT 
      tourist_id,
      first_name,
      last_name,
      email,
      phone,
      nationality,
      picture,
      arrival_date,
      departure_date,
      verified_at
    FROM tourists WHERE 1=1`

    const params = []

    // Build search query based on available info
    if (touristInfo.name) {
      const nameParts = touristInfo.name.toLowerCase().split(" ")
      if (nameParts.length >= 2) {
        query += ` AND (LOWER(first_name) LIKE ? AND LOWER(last_name) LIKE ?)`
        params.push(`%${nameParts[0]}%`, `%${nameParts[nameParts.length - 1]}%`)
      } else {
        query += ` AND (LOWER(first_name) LIKE ? OR LOWER(last_name) LIKE ?)`
        params.push(`%${nameParts[0]}%`, `%${nameParts[0]}%`)
      }
    }

    if (touristInfo.phone) {
      query += ` AND phone LIKE ?`
      params.push(`%${touristInfo.phone}%`)
    }

    console.log("🔍 Search query:", query)
    console.log("🔍 Search params:", params)

    const [tourists] = await db.query(query, params)

    if (tourists.length === 0) {
      return res.status(404).json({
        success: false,
        message: `Tourist not found. Searched for: ${touristInfo.name || "Unknown"}, Phone: ${touristInfo.phone || "Unknown"}`,
      })
    }

    // If multiple matches, return the first one
    const tourist = tourists[0]
    console.log("✅ Found tourist:", tourist.first_name, tourist.last_name)
    console.log("📸 Tourist picture path:", tourist.picture)

    res.json({
      success: true,
      tourist: tourist,
      matches: tourists.length > 1 ? `Found ${tourists.length} matches, showing first result` : null,
    })
  } catch (error) {
    console.error("❌ QR scan error:", error)
    res.status(500).json({
      success: false,
      message: "QR scan failed: " + error.message,
    })
  }
})

// Helper function to extract tourist info from QR text
function extractTouristInfoFromQR(qrData) {
  console.log("🔍 Parsing QR data:", qrData)

  try {
    // Try JSON format first
    const jsonData = JSON.parse(qrData)
    return {
      id: jsonData.tourist_id || jsonData.id,
      name: jsonData.name,
      phone: jsonData.phone,
    }
  } catch {
    // Handle text format: "Name: janine lubaton, Phone: 0699461, Type: Regular Tourist"
    const info = {}

    // Extract name
    const nameMatch = qrData.match(/Name:\s*([^,]+)/i)
    if (nameMatch) {
      info.name = nameMatch[1].trim()
    }

    // Extract phone
    const phoneMatch = qrData.match(/Phone:\s*([^,]+)/i)
    if (phoneMatch) {
      info.phone = phoneMatch[1].trim()
    }

    // Extract type
    const typeMatch = qrData.match(/Type:\s*([^,]+)/i)
    if (typeMatch) {
      info.type = typeMatch[1].trim()
    }

    // Try to extract tourist ID if present
    const idMatch = qrData.match(/ID:\s*(\d+)/i)
    if (idMatch) {
      info.id = Number.parseInt(idMatch[1])
    }

    console.log("📋 Parsed info:", info)
    return Object.keys(info).length > 0 ? info : null
  }
}

// Activity Provider Dashboard
router.get("/activities", sessionAuth, roleAuth(["activity_provider"]), async (req, res) => {
  try {
    console.log("Activity dashboard accessed by user:", req.session.user)

    // Check if packages table exists
    let packages = []
    let bookings = []

    try {
      const [packagesResult] = await db.query(`
        SELECT p.*, 
               (SELECT COUNT(*) FROM reviews r WHERE r.package_id = p.id) as review_count,
               (SELECT AVG(rating) FROM reviews r WHERE r.package_id = p.id) as average_rating
        FROM packages p 
        WHERE created_by = ? 
        ORDER BY created_at DESC
      `, [
        req.session.user.user_id,
      ])
      packages = packagesResult
    } catch (packagesError) {
      console.log("Packages table might not exist:", packagesError.message)
    }

    try {
      const [bookingsResult] = await db.query(
        `
              SELECT b.*, p.name as package_name, p.activity_type,
                     t.first_name, t.last_name, t.email, t.phone,
                     r.rating, r.comment, r.created_at as review_date
              FROM bookings b
              JOIN packages p ON b.package_id = p.id
              JOIN tourists t ON b.tourist_id = t.tourist_id
              LEFT JOIN reviews r ON b.id = r.booking_id
              WHERE p.created_by = ?
              ORDER BY b.created_at DESC
          `,
        [req.session.user.user_id],
      )
      bookings = bookingsResult
    } catch (bookingsError) {
      console.log("Bookings query failed:", bookingsError.message)
    }

    // Calculate stats
    const totalRevenue = bookings.reduce((sum, booking) => sum + Number.parseFloat(booking.total_amount || 0), 0)
    const activeBookings = bookings.filter((b) => b.status === "confirmed").length

    const stats = {
      totalPackages: packages.length,
      totalBookings: bookings.length,
      monthlyRevenue: totalRevenue,
      activeBookings: activeBookings,
    }

    res.render("provider/activity-dashboard", {
      title: "Activity Provider Dashboard",
      packages: packages,
      bookings: bookings,
      stats: stats,
      user: req.session.user,
    })
  } catch (error) {
    console.error("❌ Activity dashboard error:", error)
    res.status(500).json({
      error: "Error loading dashboard",
      message: error.message,
      details: process.env.NODE_ENV === "development" ? error.stack : undefined,
    })
  }
})

// Create Package
router.post("/activities/packages", sessionAuth, roleAuth(["activity_provider"]), async (req, res) => {
  try {
    const { name, activity_type, description, price, duration, max_participants, includes } = req.body

    const [result] = await db.query(
      `
            INSERT INTO packages (name, activity_type, description, price, duration, max_participants, includes, created_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
      [name, activity_type, description, price, duration, max_participants, includes, req.session.user.user_id],
    )

    res.json({ success: true, message: "Package created successfully", packageId: result.insertId })
  } catch (error) {
    console.error("Package creation error:", error)
    res.status(500).json({ success: false, message: "Failed to create package" })
  }
})

// Update Booking Status
router.post(
  "/activities/bookings/:bookingId/status",
  sessionAuth,
  roleAuth(["activity_provider"]),
  async (req, res) => {
    try {
      const { bookingId } = req.params;
      const { status } = req.body;
      const providerId = req.session.user.user_id;

      // Update booking status and store who confirmed it
      await db.query(
        `
            UPDATE bookings 
            SET status = ?, 
                confirmed_by = ?,
                updated_at = NOW() 
            WHERE id = ?
        `,
        [status, providerId, bookingId],
      );

      res.json({ success: true, message: "Booking status updated successfully" });
    } catch (error) {
      console.error("Booking update error:", error);
      res.status(500).json({ success: false, message: "Failed to update booking status" });
    }
  },
);

// Helper function to extract tourist ID from QR code
function extractTouristIdFromQR(qrData) {
  console.log("Extracting tourist ID from:", qrData)

  try {
    // Try parsing as JSON first
    const data = JSON.parse(qrData)
    return data.tourist_id || data.id
  } catch {
    // If not JSON, try as plain number
    const id = Number.parseInt(qrData)
    return isNaN(id) ? null : id
  }
}

module.exports = router
