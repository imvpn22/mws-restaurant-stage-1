// var restaurant;
var newMap;

/**
 * Initialize map as soon as the page is loaded.
 */
document.addEventListener('DOMContentLoaded', (event) => {
	initMap();
});

/**
 * Initialize leaflet map
 */
initMap = () => {
	fetchRestaurantFromURL((error, restaurant) => {
		if (error) { // Got an error!
			console.error(error);
		} else {
			self.newMap = L.map('map', {
				center: [restaurant.latlng.lat, restaurant.latlng.lng],
				zoom: 16,
				scrollWheelZoom: false
			});
			L.tileLayer('https://api.tiles.mapbox.com/v4/{id}/{z}/{x}/{y}.jpg70?access_token={mapboxToken}', {
				mapboxToken: 'pk.eyJ1IjoiaW12cG4yMiIsImEiOiJjaml2bnlycGExM3FuM3FxbTc0eWM2NHV2In0.ESs374xN3guFAGO_1EPdmQ',
				maxZoom: 18,
				attribution: 'Map data &copy; <a href="https://www.openstreetmap.org/">OpenStreetMap</a> contributors, ' +
				'<a href="https://creativecommons.org/licenses/by-sa/2.0/">CC-BY-SA</a>, ' +
				'Imagery © <a href="https://www.mapbox.com/">Mapbox</a>',
				id: 'mapbox.streets'
			}).addTo(newMap);
			fillBreadcrumb();
			DBHelper.mapMarkerForRestaurant(self.restaurant, self.newMap);
		}
	});
};

/* window.initMap = () => {
  fetchRestaurantFromURL((error, restaurant) => {
	if (error) { // Got an error!
	  console.error(error);
	} else {
	  self.map = new google.maps.Map(document.getElementById('map'), {
		zoom: 16,
		center: restaurant.latlng,
		scrollwheel: false
	  });
	  fillBreadcrumb();
	  DBHelper.mapMarkerForRestaurant(self.restaurant, self.map);
	}
  });
} */

/**
 * Get current restaurant from page URL.
 */
fetchRestaurantFromURL = (callback) => {
	if (self.restaurant) { // restaurant already fetched!
		callback(null, self.restaurant);
		return;
	}
	const id = getParameterByName('id');
	if (!id) { // no id found in URL
		error = 'No restaurant id in URL';
		callback(error, null);
	} else {
		DBHelper.fetchRestaurantById(id, (error, restaurant) => {
			self.restaurant = restaurant;
			if (!restaurant) {
				console.error(error);
				return;
			}
			fillRestaurantHTML();
			callback(null, restaurant);
		});
	}
};

/**
 * Create restaurant HTML and add it to the webpage
 */
fillRestaurantHTML = (restaurant = self.restaurant) => {
	const name = document.getElementById('restaurant-name');
	name.innerHTML = restaurant.name;

	const address = document.getElementById('restaurant-address');
	address.innerHTML = '<i class=\'fa fa-map-marker\'></i>' + restaurant.address;

	const image = document.getElementById('restaurant-img');
	image.className = 'restaurant-img';
	image.src = DBHelper.imageUrlForRestaurant(restaurant);
	if (image.src == 'http://localhost:8080/no-image') {
		image.classList.add('fallback-image-icon');
	}
	image.alt = `${restaurant.name} restaurant image`;

	const cuisine = document.getElementById('restaurant-cuisine');
	cuisine.innerHTML = restaurant.cuisine_type;

	// fill operating hours
	if (restaurant.operating_hours) {
		fillRestaurantHoursHTML();
	}
	// fill reviews
	fillReviewsHTML();
};

/**
 * Create restaurant operating hours HTML table and add it to the webpage.
 */
fillRestaurantHoursHTML = (operatingHours = self.restaurant.operating_hours) => {
	const hours = document.getElementById('restaurant-hours');
	for (let key in operatingHours) {
		const row = document.createElement('tr');

		const day = document.createElement('td');
		day.innerHTML = key;
		row.appendChild(day);

		const time = document.createElement('td');
		time.innerHTML = operatingHours[key];
		row.appendChild(time);

		hours.appendChild(row);
	}
};

/**
 * Create all reviews HTML and add them to the webpage.
 */
fillReviewsHTML = (reviews = self.restaurant.reviews) => {
	const container = document.getElementById('reviews-container');
	const title = document.createElement('h2');
	title.innerHTML = 'Reviews';
	title.setAttribute('tabindex', 0);
	container.appendChild(title);

	if (!reviews) {
		const noReviews = document.createElement('p');
		noReviews.innerHTML = 'No reviews yet!';
		noReviews.setAttribute('tabindex', 0);
		container.appendChild(noReviews);
		return;
	}
	const ul = document.getElementById('reviews-list');
	reviews.forEach(review => {
		ul.appendChild(createReviewHTML(review));
	});
	container.appendChild(ul);
};

/**
 * Create review HTML and add it to the webpage.
 */
createReviewHTML = (review) => {
	const li = document.createElement('li');
	li.setAttribute('tabindex', 0);
	const name = document.createElement('p');
	name.className = 'review-user';
	name.innerHTML = '<i class=\'fa fa-user\'></i>' + review.name;
	name.setAttribute('tabindex', 0);
	li.appendChild(name);

	const date = document.createElement('p');
	date.className = 'review-date';
	date.innerHTML = '<i class=\'fa fa-calendar\'></i>' + review.date;
	date.setAttribute('tabindex', 0);
	li.appendChild(date);

	const rating = document.createElement('p');
	rating.className = 'review-rating';
	// rating.innerHTML = `<i class='fa fa-star'></i>Rating: ${review.rating}`;
	rating.innerHTML = '';
	rating.setAttribute('tabindex', 0);
	rating.setAttribute('aria-label', `Rating: ${review.rating} out of 5 stars`);

	// Filled star for rating
	for (i=0; i<review.rating; i++) {
		let star = document.createElement('i');
		star.className = 'fa fa-star';
		rating.appendChild(star);
	}
	for (i=review.rating; i<5; i++) {
		let star = document.createElement('i');
		star.className = 'far fa-star';
		rating.appendChild(star);
	}
	li.appendChild(rating);

	const comments = document.createElement('p');
	comments.className = 'review-comments';
	comments.innerHTML = review.comments;
	comments.setAttribute('tabindex', 0);
	li.appendChild(comments);

	return li;
};

/**
 * Add restaurant name to the breadcrumb navigation menu
 */
fillBreadcrumb = (restaurant=self.restaurant) => {
	const breadcrumb = document.getElementById('breadcrumb');
	const li = document.createElement('li');
	li.innerHTML = restaurant.name;
	breadcrumb.appendChild(li);
};

/**
 * Get a parameter by name from page URL.
 */
getParameterByName = (name, url) => {
	if (!url)
		url = window.location.href;
	name = name.replace(/[\[\]]/g, '\\$&');
	const regex = new RegExp(`[?&]${name}(=([^&#]*)|&|#|$)`),
	results = regex.exec(url);
	if (!results)
		return null;
	if (!results[2])
		return '';
	return decodeURIComponent(results[2].replace(/\+/g, ' '));
};

//# sourceMappingURL=data:application/json;charset=utf8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiIiwic291cmNlcyI6WyJyZXN0YXVyYW50SW5mby5qcyJdLCJzb3VyY2VzQ29udGVudCI6WyIvLyB2YXIgcmVzdGF1cmFudDtcbnZhciBuZXdNYXA7XG5cbi8qKlxuICogSW5pdGlhbGl6ZSBtYXAgYXMgc29vbiBhcyB0aGUgcGFnZSBpcyBsb2FkZWQuXG4gKi9cbmRvY3VtZW50LmFkZEV2ZW50TGlzdGVuZXIoJ0RPTUNvbnRlbnRMb2FkZWQnLCAoZXZlbnQpID0+IHtcblx0aW5pdE1hcCgpO1xufSk7XG5cbi8qKlxuICogSW5pdGlhbGl6ZSBsZWFmbGV0IG1hcFxuICovXG5pbml0TWFwID0gKCkgPT4ge1xuXHRmZXRjaFJlc3RhdXJhbnRGcm9tVVJMKChlcnJvciwgcmVzdGF1cmFudCkgPT4ge1xuXHRcdGlmIChlcnJvcikgeyAvLyBHb3QgYW4gZXJyb3IhXG5cdFx0XHRjb25zb2xlLmVycm9yKGVycm9yKTtcblx0XHR9IGVsc2Uge1xuXHRcdFx0c2VsZi5uZXdNYXAgPSBMLm1hcCgnbWFwJywge1xuXHRcdFx0XHRjZW50ZXI6IFtyZXN0YXVyYW50LmxhdGxuZy5sYXQsIHJlc3RhdXJhbnQubGF0bG5nLmxuZ10sXG5cdFx0XHRcdHpvb206IDE2LFxuXHRcdFx0XHRzY3JvbGxXaGVlbFpvb206IGZhbHNlXG5cdFx0XHR9KTtcblx0XHRcdEwudGlsZUxheWVyKCdodHRwczovL2FwaS50aWxlcy5tYXBib3guY29tL3Y0L3tpZH0ve3p9L3t4fS97eX0uanBnNzA/YWNjZXNzX3Rva2VuPXttYXBib3hUb2tlbn0nLCB7XG5cdFx0XHRcdG1hcGJveFRva2VuOiAncGsuZXlKMUlqb2lhVzEyY0c0eU1pSXNJbUVpT2lKamFtbDJibmx5Y0dFeE0zRnVNM0Z4YlRjMGVXTTJOSFYySW4wLkVTczM3NHhOM2d1RkFHT18xRVBkbVEnLFxuXHRcdFx0XHRtYXhab29tOiAxOCxcblx0XHRcdFx0YXR0cmlidXRpb246ICdNYXAgZGF0YSAmY29weTsgPGEgaHJlZj1cImh0dHBzOi8vd3d3Lm9wZW5zdHJlZXRtYXAub3JnL1wiPk9wZW5TdHJlZXRNYXA8L2E+IGNvbnRyaWJ1dG9ycywgJyArXG5cdFx0XHRcdCc8YSBocmVmPVwiaHR0cHM6Ly9jcmVhdGl2ZWNvbW1vbnMub3JnL2xpY2Vuc2VzL2J5LXNhLzIuMC9cIj5DQy1CWS1TQTwvYT4sICcgK1xuXHRcdFx0XHQnSW1hZ2VyeSDCqSA8YSBocmVmPVwiaHR0cHM6Ly93d3cubWFwYm94LmNvbS9cIj5NYXBib3g8L2E+Jyxcblx0XHRcdFx0aWQ6ICdtYXBib3guc3RyZWV0cydcblx0XHRcdH0pLmFkZFRvKG5ld01hcCk7XG5cdFx0XHRmaWxsQnJlYWRjcnVtYigpO1xuXHRcdFx0REJIZWxwZXIubWFwTWFya2VyRm9yUmVzdGF1cmFudChzZWxmLnJlc3RhdXJhbnQsIHNlbGYubmV3TWFwKTtcblx0XHR9XG5cdH0pO1xufTtcblxuLyogd2luZG93LmluaXRNYXAgPSAoKSA9PiB7XG4gIGZldGNoUmVzdGF1cmFudEZyb21VUkwoKGVycm9yLCByZXN0YXVyYW50KSA9PiB7XG5cdGlmIChlcnJvcikgeyAvLyBHb3QgYW4gZXJyb3IhXG5cdCAgY29uc29sZS5lcnJvcihlcnJvcik7XG5cdH0gZWxzZSB7XG5cdCAgc2VsZi5tYXAgPSBuZXcgZ29vZ2xlLm1hcHMuTWFwKGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdtYXAnKSwge1xuXHRcdHpvb206IDE2LFxuXHRcdGNlbnRlcjogcmVzdGF1cmFudC5sYXRsbmcsXG5cdFx0c2Nyb2xsd2hlZWw6IGZhbHNlXG5cdCAgfSk7XG5cdCAgZmlsbEJyZWFkY3J1bWIoKTtcblx0ICBEQkhlbHBlci5tYXBNYXJrZXJGb3JSZXN0YXVyYW50KHNlbGYucmVzdGF1cmFudCwgc2VsZi5tYXApO1xuXHR9XG4gIH0pO1xufSAqL1xuXG4vKipcbiAqIEdldCBjdXJyZW50IHJlc3RhdXJhbnQgZnJvbSBwYWdlIFVSTC5cbiAqL1xuZmV0Y2hSZXN0YXVyYW50RnJvbVVSTCA9IChjYWxsYmFjaykgPT4ge1xuXHRpZiAoc2VsZi5yZXN0YXVyYW50KSB7IC8vIHJlc3RhdXJhbnQgYWxyZWFkeSBmZXRjaGVkIVxuXHRcdGNhbGxiYWNrKG51bGwsIHNlbGYucmVzdGF1cmFudCk7XG5cdFx0cmV0dXJuO1xuXHR9XG5cdGNvbnN0IGlkID0gZ2V0UGFyYW1ldGVyQnlOYW1lKCdpZCcpO1xuXHRpZiAoIWlkKSB7IC8vIG5vIGlkIGZvdW5kIGluIFVSTFxuXHRcdGVycm9yID0gJ05vIHJlc3RhdXJhbnQgaWQgaW4gVVJMJztcblx0XHRjYWxsYmFjayhlcnJvciwgbnVsbCk7XG5cdH0gZWxzZSB7XG5cdFx0REJIZWxwZXIuZmV0Y2hSZXN0YXVyYW50QnlJZChpZCwgKGVycm9yLCByZXN0YXVyYW50KSA9PiB7XG5cdFx0XHRzZWxmLnJlc3RhdXJhbnQgPSByZXN0YXVyYW50O1xuXHRcdFx0aWYgKCFyZXN0YXVyYW50KSB7XG5cdFx0XHRcdGNvbnNvbGUuZXJyb3IoZXJyb3IpO1xuXHRcdFx0XHRyZXR1cm47XG5cdFx0XHR9XG5cdFx0XHRmaWxsUmVzdGF1cmFudEhUTUwoKTtcblx0XHRcdGNhbGxiYWNrKG51bGwsIHJlc3RhdXJhbnQpO1xuXHRcdH0pO1xuXHR9XG59O1xuXG4vKipcbiAqIENyZWF0ZSByZXN0YXVyYW50IEhUTUwgYW5kIGFkZCBpdCB0byB0aGUgd2VicGFnZVxuICovXG5maWxsUmVzdGF1cmFudEhUTUwgPSAocmVzdGF1cmFudCA9IHNlbGYucmVzdGF1cmFudCkgPT4ge1xuXHRjb25zdCBuYW1lID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3Jlc3RhdXJhbnQtbmFtZScpO1xuXHRuYW1lLmlubmVySFRNTCA9IHJlc3RhdXJhbnQubmFtZTtcblxuXHRjb25zdCBhZGRyZXNzID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3Jlc3RhdXJhbnQtYWRkcmVzcycpO1xuXHRhZGRyZXNzLmlubmVySFRNTCA9ICc8aSBjbGFzcz1cXCdmYSBmYS1tYXAtbWFya2VyXFwnPjwvaT4nICsgcmVzdGF1cmFudC5hZGRyZXNzO1xuXG5cdGNvbnN0IGltYWdlID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3Jlc3RhdXJhbnQtaW1nJyk7XG5cdGltYWdlLmNsYXNzTmFtZSA9ICdyZXN0YXVyYW50LWltZyc7XG5cdGltYWdlLnNyYyA9IERCSGVscGVyLmltYWdlVXJsRm9yUmVzdGF1cmFudChyZXN0YXVyYW50KTtcblx0aWYgKGltYWdlLnNyYyA9PSAnaHR0cDovL2xvY2FsaG9zdDo4MDgwL25vLWltYWdlJykge1xuXHRcdGltYWdlLmNsYXNzTGlzdC5hZGQoJ2ZhbGxiYWNrLWltYWdlLWljb24nKTtcblx0fVxuXHRpbWFnZS5hbHQgPSBgJHtyZXN0YXVyYW50Lm5hbWV9IHJlc3RhdXJhbnQgaW1hZ2VgO1xuXG5cdGNvbnN0IGN1aXNpbmUgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgncmVzdGF1cmFudC1jdWlzaW5lJyk7XG5cdGN1aXNpbmUuaW5uZXJIVE1MID0gcmVzdGF1cmFudC5jdWlzaW5lX3R5cGU7XG5cblx0Ly8gZmlsbCBvcGVyYXRpbmcgaG91cnNcblx0aWYgKHJlc3RhdXJhbnQub3BlcmF0aW5nX2hvdXJzKSB7XG5cdFx0ZmlsbFJlc3RhdXJhbnRIb3Vyc0hUTUwoKTtcblx0fVxuXHQvLyBmaWxsIHJldmlld3Ncblx0ZmlsbFJldmlld3NIVE1MKCk7XG59O1xuXG4vKipcbiAqIENyZWF0ZSByZXN0YXVyYW50IG9wZXJhdGluZyBob3VycyBIVE1MIHRhYmxlIGFuZCBhZGQgaXQgdG8gdGhlIHdlYnBhZ2UuXG4gKi9cbmZpbGxSZXN0YXVyYW50SG91cnNIVE1MID0gKG9wZXJhdGluZ0hvdXJzID0gc2VsZi5yZXN0YXVyYW50Lm9wZXJhdGluZ19ob3VycykgPT4ge1xuXHRjb25zdCBob3VycyA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdyZXN0YXVyYW50LWhvdXJzJyk7XG5cdGZvciAobGV0IGtleSBpbiBvcGVyYXRpbmdIb3Vycykge1xuXHRcdGNvbnN0IHJvdyA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ3RyJyk7XG5cblx0XHRjb25zdCBkYXkgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCd0ZCcpO1xuXHRcdGRheS5pbm5lckhUTUwgPSBrZXk7XG5cdFx0cm93LmFwcGVuZENoaWxkKGRheSk7XG5cblx0XHRjb25zdCB0aW1lID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgndGQnKTtcblx0XHR0aW1lLmlubmVySFRNTCA9IG9wZXJhdGluZ0hvdXJzW2tleV07XG5cdFx0cm93LmFwcGVuZENoaWxkKHRpbWUpO1xuXG5cdFx0aG91cnMuYXBwZW5kQ2hpbGQocm93KTtcblx0fVxufTtcblxuLyoqXG4gKiBDcmVhdGUgYWxsIHJldmlld3MgSFRNTCBhbmQgYWRkIHRoZW0gdG8gdGhlIHdlYnBhZ2UuXG4gKi9cbmZpbGxSZXZpZXdzSFRNTCA9IChyZXZpZXdzID0gc2VsZi5yZXN0YXVyYW50LnJldmlld3MpID0+IHtcblx0Y29uc3QgY29udGFpbmVyID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3Jldmlld3MtY29udGFpbmVyJyk7XG5cdGNvbnN0IHRpdGxlID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnaDInKTtcblx0dGl0bGUuaW5uZXJIVE1MID0gJ1Jldmlld3MnO1xuXHR0aXRsZS5zZXRBdHRyaWJ1dGUoJ3RhYmluZGV4JywgMCk7XG5cdGNvbnRhaW5lci5hcHBlbmRDaGlsZCh0aXRsZSk7XG5cblx0aWYgKCFyZXZpZXdzKSB7XG5cdFx0Y29uc3Qgbm9SZXZpZXdzID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgncCcpO1xuXHRcdG5vUmV2aWV3cy5pbm5lckhUTUwgPSAnTm8gcmV2aWV3cyB5ZXQhJztcblx0XHRub1Jldmlld3Muc2V0QXR0cmlidXRlKCd0YWJpbmRleCcsIDApO1xuXHRcdGNvbnRhaW5lci5hcHBlbmRDaGlsZChub1Jldmlld3MpO1xuXHRcdHJldHVybjtcblx0fVxuXHRjb25zdCB1bCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdyZXZpZXdzLWxpc3QnKTtcblx0cmV2aWV3cy5mb3JFYWNoKHJldmlldyA9PiB7XG5cdFx0dWwuYXBwZW5kQ2hpbGQoY3JlYXRlUmV2aWV3SFRNTChyZXZpZXcpKTtcblx0fSk7XG5cdGNvbnRhaW5lci5hcHBlbmRDaGlsZCh1bCk7XG59O1xuXG4vKipcbiAqIENyZWF0ZSByZXZpZXcgSFRNTCBhbmQgYWRkIGl0IHRvIHRoZSB3ZWJwYWdlLlxuICovXG5jcmVhdGVSZXZpZXdIVE1MID0gKHJldmlldykgPT4ge1xuXHRjb25zdCBsaSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2xpJyk7XG5cdGxpLnNldEF0dHJpYnV0ZSgndGFiaW5kZXgnLCAwKTtcblx0Y29uc3QgbmFtZSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ3AnKTtcblx0bmFtZS5jbGFzc05hbWUgPSAncmV2aWV3LXVzZXInO1xuXHRuYW1lLmlubmVySFRNTCA9ICc8aSBjbGFzcz1cXCdmYSBmYS11c2VyXFwnPjwvaT4nICsgcmV2aWV3Lm5hbWU7XG5cdG5hbWUuc2V0QXR0cmlidXRlKCd0YWJpbmRleCcsIDApO1xuXHRsaS5hcHBlbmRDaGlsZChuYW1lKTtcblxuXHRjb25zdCBkYXRlID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgncCcpO1xuXHRkYXRlLmNsYXNzTmFtZSA9ICdyZXZpZXctZGF0ZSc7XG5cdGRhdGUuaW5uZXJIVE1MID0gJzxpIGNsYXNzPVxcJ2ZhIGZhLWNhbGVuZGFyXFwnPjwvaT4nICsgcmV2aWV3LmRhdGU7XG5cdGRhdGUuc2V0QXR0cmlidXRlKCd0YWJpbmRleCcsIDApO1xuXHRsaS5hcHBlbmRDaGlsZChkYXRlKTtcblxuXHRjb25zdCByYXRpbmcgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdwJyk7XG5cdHJhdGluZy5jbGFzc05hbWUgPSAncmV2aWV3LXJhdGluZyc7XG5cdC8vIHJhdGluZy5pbm5lckhUTUwgPSBgPGkgY2xhc3M9J2ZhIGZhLXN0YXInPjwvaT5SYXRpbmc6ICR7cmV2aWV3LnJhdGluZ31gO1xuXHRyYXRpbmcuaW5uZXJIVE1MID0gJyc7XG5cdHJhdGluZy5zZXRBdHRyaWJ1dGUoJ3RhYmluZGV4JywgMCk7XG5cdHJhdGluZy5zZXRBdHRyaWJ1dGUoJ2FyaWEtbGFiZWwnLCBgUmF0aW5nOiAke3Jldmlldy5yYXRpbmd9IG91dCBvZiA1IHN0YXJzYCk7XG5cblx0Ly8gRmlsbGVkIHN0YXIgZm9yIHJhdGluZ1xuXHRmb3IgKGk9MDsgaTxyZXZpZXcucmF0aW5nOyBpKyspIHtcblx0XHRsZXQgc3RhciA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2knKTtcblx0XHRzdGFyLmNsYXNzTmFtZSA9ICdmYSBmYS1zdGFyJztcblx0XHRyYXRpbmcuYXBwZW5kQ2hpbGQoc3Rhcik7XG5cdH1cblx0Zm9yIChpPXJldmlldy5yYXRpbmc7IGk8NTsgaSsrKSB7XG5cdFx0bGV0IHN0YXIgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdpJyk7XG5cdFx0c3Rhci5jbGFzc05hbWUgPSAnZmFyIGZhLXN0YXInO1xuXHRcdHJhdGluZy5hcHBlbmRDaGlsZChzdGFyKTtcblx0fVxuXHRsaS5hcHBlbmRDaGlsZChyYXRpbmcpO1xuXG5cdGNvbnN0IGNvbW1lbnRzID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgncCcpO1xuXHRjb21tZW50cy5jbGFzc05hbWUgPSAncmV2aWV3LWNvbW1lbnRzJztcblx0Y29tbWVudHMuaW5uZXJIVE1MID0gcmV2aWV3LmNvbW1lbnRzO1xuXHRjb21tZW50cy5zZXRBdHRyaWJ1dGUoJ3RhYmluZGV4JywgMCk7XG5cdGxpLmFwcGVuZENoaWxkKGNvbW1lbnRzKTtcblxuXHRyZXR1cm4gbGk7XG59O1xuXG4vKipcbiAqIEFkZCByZXN0YXVyYW50IG5hbWUgdG8gdGhlIGJyZWFkY3J1bWIgbmF2aWdhdGlvbiBtZW51XG4gKi9cbmZpbGxCcmVhZGNydW1iID0gKHJlc3RhdXJhbnQ9c2VsZi5yZXN0YXVyYW50KSA9PiB7XG5cdGNvbnN0IGJyZWFkY3J1bWIgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnYnJlYWRjcnVtYicpO1xuXHRjb25zdCBsaSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2xpJyk7XG5cdGxpLmlubmVySFRNTCA9IHJlc3RhdXJhbnQubmFtZTtcblx0YnJlYWRjcnVtYi5hcHBlbmRDaGlsZChsaSk7XG59O1xuXG4vKipcbiAqIEdldCBhIHBhcmFtZXRlciBieSBuYW1lIGZyb20gcGFnZSBVUkwuXG4gKi9cbmdldFBhcmFtZXRlckJ5TmFtZSA9IChuYW1lLCB1cmwpID0+IHtcblx0aWYgKCF1cmwpXG5cdFx0dXJsID0gd2luZG93LmxvY2F0aW9uLmhyZWY7XG5cdG5hbWUgPSBuYW1lLnJlcGxhY2UoL1tcXFtcXF1dL2csICdcXFxcJCYnKTtcblx0Y29uc3QgcmVnZXggPSBuZXcgUmVnRXhwKGBbPyZdJHtuYW1lfSg9KFteJiNdKil8JnwjfCQpYCksXG5cdHJlc3VsdHMgPSByZWdleC5leGVjKHVybCk7XG5cdGlmICghcmVzdWx0cylcblx0XHRyZXR1cm4gbnVsbDtcblx0aWYgKCFyZXN1bHRzWzJdKVxuXHRcdHJldHVybiAnJztcblx0cmV0dXJuIGRlY29kZVVSSUNvbXBvbmVudChyZXN1bHRzWzJdLnJlcGxhY2UoL1xcKy9nLCAnICcpKTtcbn07XG4iXSwiZmlsZSI6InJlc3RhdXJhbnRJbmZvLmpzIn0=
