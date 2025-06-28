const express = require('express');
const router = express.Router();
const db = require('../config/db');
const sessionAuth = require('../middleware/sessionAuth');

// Create a new review
router.post('/api/reviews', sessionAuth, async (req, res) => {
    try {
        const { booking_id, package_id, rating, comment } = req.body;
        const user_id = req.session.user.user_id;

        // Check if the booking belongs to the user
        const [booking] = await db.query(
            'SELECT b.*, p.id as package_id FROM bookings b JOIN packages p ON b.package_id = p.id WHERE b.id = ? AND b.user_id = ? AND b.status = "completed"',
            [booking_id, user_id]
        );

        if (!booking.length) {
            return res.status(403).json({
                success: false,
                message: 'You can only review your own completed bookings'
            });
        }

        // Use the package_id from the booking if not provided in the request
        const bookingPackageId = booking[0].package_id;
        const reviewPackageId = package_id || bookingPackageId;

        // Check if a review already exists
        const [existingReview] = await db.query(
            'SELECT * FROM reviews WHERE booking_id = ?',
            [booking_id]
        );

        if (existingReview.length) {
            return res.status(400).json({
                success: false,
                message: 'You have already reviewed this booking'
            });
        }

        // Create the review
        await db.query(
            `INSERT INTO reviews (booking_id, user_id, package_id, rating, comment)
             VALUES (?, ?, ?, ?, ?)`,
            [booking_id, user_id, reviewPackageId, rating, comment]
        );

        res.json({
            success: true,
            message: 'Review submitted successfully'
        });
    } catch (error) {
        console.error('Error creating review:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to submit review'
        });
    }
});

// Get reviews for a package
router.get('/api/packages/:packageId/reviews', async (req, res) => {
    try {
        const { packageId } = req.params;
        const [reviews] = await db.query(
            `SELECT r.*, u.first_name, u.last_name 
             FROM reviews r
             JOIN users u ON r.user_id = u.user_id
             WHERE r.package_id = ?
             ORDER BY r.created_at DESC`,
            [packageId]
        );

        res.json({
            success: true,
            reviews
        });
    } catch (error) {
        console.error('Error fetching reviews:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch reviews'
        });
    }
});

module.exports = router; 