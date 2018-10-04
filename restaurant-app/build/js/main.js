// var restaurants;
// var neighborhoods;
// var cuisines;
// var newMap;
// var markers = [];

/**
 * Fetch neighborhoods and cuisines as soon as the page is loaded.
 */
 document.addEventListener('DOMContentLoaded', (event) => {
	initMap(); // added
	fetchNeighborhoods();
	fetchCuisines();
});

/**
 * Fetch all neighborhoods and set their HTML.
 */
 fetchNeighborhoods = () => {
	DBHelper.fetchNeighborhoods((error, neighborhoods) => {
		if (error) { // Got an error
			console.error(error);
		} else {
			self.neighborhoods = neighborhoods;
			fillNeighborhoodsHTML();
		}
	});
 };

/**
 * Set neighborhoods HTML.
 */
 fillNeighborhoodsHTML = (neighborhoods = self.neighborhoods) => {
	const select = document.getElementById('neighborhoods-select');
	neighborhoods.forEach(neighborhood => {
		const option = document.createElement('option');
		option.innerHTML = neighborhood;
		option.value = neighborhood;
		select.append(option);
	});
 };

/**
 * Fetch all cuisines and set their HTML.
 */
 fetchCuisines = () => {
	DBHelper.fetchCuisines((error, cuisines) => {
		if (error) { // Got an error!
			console.error(error);
		} else {
			self.cuisines = cuisines;
			fillCuisinesHTML();
		}
	});
 };

/**
 * Set cuisines HTML.
 */
 fillCuisinesHTML = (cuisines = self.cuisines) => {
	const select = document.getElementById('cuisines-select');

	cuisines.forEach(cuisine => {
		const option = document.createElement('option');
		option.innerHTML = cuisine;
		option.value = cuisine;
		select.append(option);
	});
 };

/**
 * Initialize leaflet map, called from HTML.
 */
 initMap = () => {
	self.newMap = L.map('map', {
		center: [40.722216, -73.987501],
		zoom: 12,
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

	updateRestaurants();
 };
/* window.initMap = () => {
  let loc = {
	lat: 40.722216,
	lng: -73.987501
  };
  self.map = new google.maps.Map(document.getElementById('map'), {
	zoom: 12,
	center: loc,
	scrollwheel: false
  });
  updateRestaurants();
} */

/**
 * Update page and map for current restalisturants.
 */
 updateRestaurants = () => {
	const cSelect = document.getElementById('cuisines-select');
	const nSelect = document.getElementById('neighborhoods-select');

	const cIndex = cSelect.selectedIndex;
	const nIndex = nSelect.selectedIndex;

	const cuisine = cSelect[cIndex].value;
	const neighborhood = nSelect[nIndex].value;

	DBHelper.fetchRestaurantByCuisineAndNeighborhood(cuisine, neighborhood, (error, restaurants) => {
		if (error) { // Got an error!
			console.error(error);
		} else {
			resetRestaurants(restaurants);
			fillRestaurantsHTML();
		}
	});
 };

/**
 * Clear current restaurants, their HTML and remove their map markers.
 */
 resetRestaurants = (restaurants) => {
	// Remove all restaurants
	self.restaurants = [];
	const ul = document.getElementById('restaurants-list');
	ul.innerHTML = '';

	// Remove all map markers
	if (self.markers) {
		self.markers.forEach(marker => marker.remove());
	}
	self.markers = [];
	self.restaurants = restaurants;
};

/**
 * Create all restaurants HTML and add them to the webpage.
 */
 fillRestaurantsHTML = (restaurants = self.restaurants) => {
	const ul = document.getElementById('restaurants-list');
	restaurants.forEach(restaurant => {
		ul.append(createRestaurantHTML(restaurant));
	});
	addMarkersToMap();
 };

/**
 * Create restaurant HTML.
 */
 createRestaurantHTML = (restaurant) => {
	const li = document.createElement('li');
	li.setAttribute('tabindex', 0);

	const image = document.createElement('img');
	image.src = DBHelper.imageUrlForRestaurant(restaurant);
	image.className = 'restaurant-img';
	if (image.src == 'http://localhost:8080/no-image') {
		image.src = '';
		image.classList.add('fallback-image-icon');
	}
	image.alt = `${restaurant.name} restaurant image`;
	image.setAttribute('tabindex', 0);
	li.append(image);

	const details = document.createElement('div');
	details.className = 'restaurant-details';
	li.append(details);

	const name = document.createElement('h2');
	name.innerHTML = restaurant.name;
	name.setAttribute('tabindex', 0);
	details.append(name);

	const neighborhood = document.createElement('p');
	neighborhood.innerHTML = restaurant.neighborhood;
	neighborhood.setAttribute('tabindex', 0);
	details.append(neighborhood);

	const address = document.createElement('p');
	address.className = 'rest-address';
	address.innerHTML = '<i class=\'fa fa-map-marker\'></i>' + restaurant.address;
	address.setAttribute('tabindex', 0);
	details.append(address);

	const more = document.createElement('a');
	more.innerHTML = 'View Details';
	more.href = DBHelper.urlForRestaurant(restaurant);
	more.setAttribute('aria-label', `View details of ${restaurant.name}`);
	details.append(more);

	return li;
 };

/**
 * Add markers for current restaurants to the map.
 */
 addMarkersToMap = (restaurants = self.restaurants) => {
	restaurants.forEach(restaurant => {
		// Add marker to the map
		const marker = DBHelper.mapMarkerForRestaurant(restaurant, self.newMap);
		marker.on('click', onClick);
		function onClick() {
			window.location.href = marker.options.url;
		}
		self.markers.push(marker);
	});

 };
/* addMarkersToMap = (restaurants = self.restaurants) => {
  restaurants.forEach(restaurant => {
	// Add marker to the map
	const marker = DBHelper.mapMarkerForRestaurant(restaurant, self.map);
	google.maps.event.addListener(marker, 'click', () => {
	  window.location.href = marker.url
	});
	self.markers.push(marker);
  });
} */


/* Manage focus and tabindex on filter options */




//# sourceMappingURL=data:application/json;charset=utf8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiIiwic291cmNlcyI6WyJtYWluLmpzIl0sInNvdXJjZXNDb250ZW50IjpbIi8vIHZhciByZXN0YXVyYW50cztcbi8vIHZhciBuZWlnaGJvcmhvb2RzO1xuLy8gdmFyIGN1aXNpbmVzO1xuLy8gdmFyIG5ld01hcDtcbi8vIHZhciBtYXJrZXJzID0gW107XG5cbi8qKlxuICogRmV0Y2ggbmVpZ2hib3Job29kcyBhbmQgY3Vpc2luZXMgYXMgc29vbiBhcyB0aGUgcGFnZSBpcyBsb2FkZWQuXG4gKi9cbiBkb2N1bWVudC5hZGRFdmVudExpc3RlbmVyKCdET01Db250ZW50TG9hZGVkJywgKGV2ZW50KSA9PiB7XG5cdGluaXRNYXAoKTsgLy8gYWRkZWRcblx0ZmV0Y2hOZWlnaGJvcmhvb2RzKCk7XG5cdGZldGNoQ3Vpc2luZXMoKTtcbn0pO1xuXG4vKipcbiAqIEZldGNoIGFsbCBuZWlnaGJvcmhvb2RzIGFuZCBzZXQgdGhlaXIgSFRNTC5cbiAqL1xuIGZldGNoTmVpZ2hib3Job29kcyA9ICgpID0+IHtcblx0REJIZWxwZXIuZmV0Y2hOZWlnaGJvcmhvb2RzKChlcnJvciwgbmVpZ2hib3Job29kcykgPT4ge1xuXHRcdGlmIChlcnJvcikgeyAvLyBHb3QgYW4gZXJyb3Jcblx0XHRcdGNvbnNvbGUuZXJyb3IoZXJyb3IpO1xuXHRcdH0gZWxzZSB7XG5cdFx0XHRzZWxmLm5laWdoYm9yaG9vZHMgPSBuZWlnaGJvcmhvb2RzO1xuXHRcdFx0ZmlsbE5laWdoYm9yaG9vZHNIVE1MKCk7XG5cdFx0fVxuXHR9KTtcbiB9O1xuXG4vKipcbiAqIFNldCBuZWlnaGJvcmhvb2RzIEhUTUwuXG4gKi9cbiBmaWxsTmVpZ2hib3Job29kc0hUTUwgPSAobmVpZ2hib3Job29kcyA9IHNlbGYubmVpZ2hib3Job29kcykgPT4ge1xuXHRjb25zdCBzZWxlY3QgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnbmVpZ2hib3Job29kcy1zZWxlY3QnKTtcblx0bmVpZ2hib3Job29kcy5mb3JFYWNoKG5laWdoYm9yaG9vZCA9PiB7XG5cdFx0Y29uc3Qgb3B0aW9uID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnb3B0aW9uJyk7XG5cdFx0b3B0aW9uLmlubmVySFRNTCA9IG5laWdoYm9yaG9vZDtcblx0XHRvcHRpb24udmFsdWUgPSBuZWlnaGJvcmhvb2Q7XG5cdFx0c2VsZWN0LmFwcGVuZChvcHRpb24pO1xuXHR9KTtcbiB9O1xuXG4vKipcbiAqIEZldGNoIGFsbCBjdWlzaW5lcyBhbmQgc2V0IHRoZWlyIEhUTUwuXG4gKi9cbiBmZXRjaEN1aXNpbmVzID0gKCkgPT4ge1xuXHREQkhlbHBlci5mZXRjaEN1aXNpbmVzKChlcnJvciwgY3Vpc2luZXMpID0+IHtcblx0XHRpZiAoZXJyb3IpIHsgLy8gR290IGFuIGVycm9yIVxuXHRcdFx0Y29uc29sZS5lcnJvcihlcnJvcik7XG5cdFx0fSBlbHNlIHtcblx0XHRcdHNlbGYuY3Vpc2luZXMgPSBjdWlzaW5lcztcblx0XHRcdGZpbGxDdWlzaW5lc0hUTUwoKTtcblx0XHR9XG5cdH0pO1xuIH07XG5cbi8qKlxuICogU2V0IGN1aXNpbmVzIEhUTUwuXG4gKi9cbiBmaWxsQ3Vpc2luZXNIVE1MID0gKGN1aXNpbmVzID0gc2VsZi5jdWlzaW5lcykgPT4ge1xuXHRjb25zdCBzZWxlY3QgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY3Vpc2luZXMtc2VsZWN0Jyk7XG5cblx0Y3Vpc2luZXMuZm9yRWFjaChjdWlzaW5lID0+IHtcblx0XHRjb25zdCBvcHRpb24gPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdvcHRpb24nKTtcblx0XHRvcHRpb24uaW5uZXJIVE1MID0gY3Vpc2luZTtcblx0XHRvcHRpb24udmFsdWUgPSBjdWlzaW5lO1xuXHRcdHNlbGVjdC5hcHBlbmQob3B0aW9uKTtcblx0fSk7XG4gfTtcblxuLyoqXG4gKiBJbml0aWFsaXplIGxlYWZsZXQgbWFwLCBjYWxsZWQgZnJvbSBIVE1MLlxuICovXG4gaW5pdE1hcCA9ICgpID0+IHtcblx0c2VsZi5uZXdNYXAgPSBMLm1hcCgnbWFwJywge1xuXHRcdGNlbnRlcjogWzQwLjcyMjIxNiwgLTczLjk4NzUwMV0sXG5cdFx0em9vbTogMTIsXG5cdFx0c2Nyb2xsV2hlZWxab29tOiBmYWxzZVxuXHR9KTtcblx0TC50aWxlTGF5ZXIoJ2h0dHBzOi8vYXBpLnRpbGVzLm1hcGJveC5jb20vdjQve2lkfS97en0ve3h9L3t5fS5qcGc3MD9hY2Nlc3NfdG9rZW49e21hcGJveFRva2VufScsIHtcblx0XHRtYXBib3hUb2tlbjogJ3BrLmV5SjFJam9pYVcxMmNHNHlNaUlzSW1FaU9pSmphbWwyYm5seWNHRXhNM0Z1TTNGeGJUYzBlV00yTkhWMkluMC5FU3MzNzR4TjNndUZBR09fMUVQZG1RJyxcblx0XHRtYXhab29tOiAxOCxcblx0XHRhdHRyaWJ1dGlvbjogJ01hcCBkYXRhICZjb3B5OyA8YSBocmVmPVwiaHR0cHM6Ly93d3cub3BlbnN0cmVldG1hcC5vcmcvXCI+T3BlblN0cmVldE1hcDwvYT4gY29udHJpYnV0b3JzLCAnICtcblx0XHQnPGEgaHJlZj1cImh0dHBzOi8vY3JlYXRpdmVjb21tb25zLm9yZy9saWNlbnNlcy9ieS1zYS8yLjAvXCI+Q0MtQlktU0E8L2E+LCAnICtcblx0XHQnSW1hZ2VyeSDCqSA8YSBocmVmPVwiaHR0cHM6Ly93d3cubWFwYm94LmNvbS9cIj5NYXBib3g8L2E+Jyxcblx0XHRpZDogJ21hcGJveC5zdHJlZXRzJ1xuXHR9KS5hZGRUbyhuZXdNYXApO1xuXG5cdHVwZGF0ZVJlc3RhdXJhbnRzKCk7XG4gfTtcbi8qIHdpbmRvdy5pbml0TWFwID0gKCkgPT4ge1xuICBsZXQgbG9jID0ge1xuXHRsYXQ6IDQwLjcyMjIxNixcblx0bG5nOiAtNzMuOTg3NTAxXG4gIH07XG4gIHNlbGYubWFwID0gbmV3IGdvb2dsZS5tYXBzLk1hcChkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnbWFwJyksIHtcblx0em9vbTogMTIsXG5cdGNlbnRlcjogbG9jLFxuXHRzY3JvbGx3aGVlbDogZmFsc2VcbiAgfSk7XG4gIHVwZGF0ZVJlc3RhdXJhbnRzKCk7XG59ICovXG5cbi8qKlxuICogVXBkYXRlIHBhZ2UgYW5kIG1hcCBmb3IgY3VycmVudCByZXN0YWxpc3R1cmFudHMuXG4gKi9cbiB1cGRhdGVSZXN0YXVyYW50cyA9ICgpID0+IHtcblx0Y29uc3QgY1NlbGVjdCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdjdWlzaW5lcy1zZWxlY3QnKTtcblx0Y29uc3QgblNlbGVjdCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCduZWlnaGJvcmhvb2RzLXNlbGVjdCcpO1xuXG5cdGNvbnN0IGNJbmRleCA9IGNTZWxlY3Quc2VsZWN0ZWRJbmRleDtcblx0Y29uc3QgbkluZGV4ID0gblNlbGVjdC5zZWxlY3RlZEluZGV4O1xuXG5cdGNvbnN0IGN1aXNpbmUgPSBjU2VsZWN0W2NJbmRleF0udmFsdWU7XG5cdGNvbnN0IG5laWdoYm9yaG9vZCA9IG5TZWxlY3RbbkluZGV4XS52YWx1ZTtcblxuXHREQkhlbHBlci5mZXRjaFJlc3RhdXJhbnRCeUN1aXNpbmVBbmROZWlnaGJvcmhvb2QoY3Vpc2luZSwgbmVpZ2hib3Job29kLCAoZXJyb3IsIHJlc3RhdXJhbnRzKSA9PiB7XG5cdFx0aWYgKGVycm9yKSB7IC8vIEdvdCBhbiBlcnJvciFcblx0XHRcdGNvbnNvbGUuZXJyb3IoZXJyb3IpO1xuXHRcdH0gZWxzZSB7XG5cdFx0XHRyZXNldFJlc3RhdXJhbnRzKHJlc3RhdXJhbnRzKTtcblx0XHRcdGZpbGxSZXN0YXVyYW50c0hUTUwoKTtcblx0XHR9XG5cdH0pO1xuIH07XG5cbi8qKlxuICogQ2xlYXIgY3VycmVudCByZXN0YXVyYW50cywgdGhlaXIgSFRNTCBhbmQgcmVtb3ZlIHRoZWlyIG1hcCBtYXJrZXJzLlxuICovXG4gcmVzZXRSZXN0YXVyYW50cyA9IChyZXN0YXVyYW50cykgPT4ge1xuXHQvLyBSZW1vdmUgYWxsIHJlc3RhdXJhbnRzXG5cdHNlbGYucmVzdGF1cmFudHMgPSBbXTtcblx0Y29uc3QgdWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgncmVzdGF1cmFudHMtbGlzdCcpO1xuXHR1bC5pbm5lckhUTUwgPSAnJztcblxuXHQvLyBSZW1vdmUgYWxsIG1hcCBtYXJrZXJzXG5cdGlmIChzZWxmLm1hcmtlcnMpIHtcblx0XHRzZWxmLm1hcmtlcnMuZm9yRWFjaChtYXJrZXIgPT4gbWFya2VyLnJlbW92ZSgpKTtcblx0fVxuXHRzZWxmLm1hcmtlcnMgPSBbXTtcblx0c2VsZi5yZXN0YXVyYW50cyA9IHJlc3RhdXJhbnRzO1xufTtcblxuLyoqXG4gKiBDcmVhdGUgYWxsIHJlc3RhdXJhbnRzIEhUTUwgYW5kIGFkZCB0aGVtIHRvIHRoZSB3ZWJwYWdlLlxuICovXG4gZmlsbFJlc3RhdXJhbnRzSFRNTCA9IChyZXN0YXVyYW50cyA9IHNlbGYucmVzdGF1cmFudHMpID0+IHtcblx0Y29uc3QgdWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgncmVzdGF1cmFudHMtbGlzdCcpO1xuXHRyZXN0YXVyYW50cy5mb3JFYWNoKHJlc3RhdXJhbnQgPT4ge1xuXHRcdHVsLmFwcGVuZChjcmVhdGVSZXN0YXVyYW50SFRNTChyZXN0YXVyYW50KSk7XG5cdH0pO1xuXHRhZGRNYXJrZXJzVG9NYXAoKTtcbiB9O1xuXG4vKipcbiAqIENyZWF0ZSByZXN0YXVyYW50IEhUTUwuXG4gKi9cbiBjcmVhdGVSZXN0YXVyYW50SFRNTCA9IChyZXN0YXVyYW50KSA9PiB7XG5cdGNvbnN0IGxpID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnbGknKTtcblx0bGkuc2V0QXR0cmlidXRlKCd0YWJpbmRleCcsIDApO1xuXG5cdGNvbnN0IGltYWdlID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnaW1nJyk7XG5cdGltYWdlLnNyYyA9IERCSGVscGVyLmltYWdlVXJsRm9yUmVzdGF1cmFudChyZXN0YXVyYW50KTtcblx0aW1hZ2UuY2xhc3NOYW1lID0gJ3Jlc3RhdXJhbnQtaW1nJztcblx0aWYgKGltYWdlLnNyYyA9PSAnaHR0cDovL2xvY2FsaG9zdDo4MDgwL25vLWltYWdlJykge1xuXHRcdGltYWdlLnNyYyA9ICcnO1xuXHRcdGltYWdlLmNsYXNzTGlzdC5hZGQoJ2ZhbGxiYWNrLWltYWdlLWljb24nKTtcblx0fVxuXHRpbWFnZS5hbHQgPSBgJHtyZXN0YXVyYW50Lm5hbWV9IHJlc3RhdXJhbnQgaW1hZ2VgO1xuXHRpbWFnZS5zZXRBdHRyaWJ1dGUoJ3RhYmluZGV4JywgMCk7XG5cdGxpLmFwcGVuZChpbWFnZSk7XG5cblx0Y29uc3QgZGV0YWlscyA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpO1xuXHRkZXRhaWxzLmNsYXNzTmFtZSA9ICdyZXN0YXVyYW50LWRldGFpbHMnO1xuXHRsaS5hcHBlbmQoZGV0YWlscyk7XG5cblx0Y29uc3QgbmFtZSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2gyJyk7XG5cdG5hbWUuaW5uZXJIVE1MID0gcmVzdGF1cmFudC5uYW1lO1xuXHRuYW1lLnNldEF0dHJpYnV0ZSgndGFiaW5kZXgnLCAwKTtcblx0ZGV0YWlscy5hcHBlbmQobmFtZSk7XG5cblx0Y29uc3QgbmVpZ2hib3Job29kID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgncCcpO1xuXHRuZWlnaGJvcmhvb2QuaW5uZXJIVE1MID0gcmVzdGF1cmFudC5uZWlnaGJvcmhvb2Q7XG5cdG5laWdoYm9yaG9vZC5zZXRBdHRyaWJ1dGUoJ3RhYmluZGV4JywgMCk7XG5cdGRldGFpbHMuYXBwZW5kKG5laWdoYm9yaG9vZCk7XG5cblx0Y29uc3QgYWRkcmVzcyA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ3AnKTtcblx0YWRkcmVzcy5jbGFzc05hbWUgPSAncmVzdC1hZGRyZXNzJztcblx0YWRkcmVzcy5pbm5lckhUTUwgPSAnPGkgY2xhc3M9XFwnZmEgZmEtbWFwLW1hcmtlclxcJz48L2k+JyArIHJlc3RhdXJhbnQuYWRkcmVzcztcblx0YWRkcmVzcy5zZXRBdHRyaWJ1dGUoJ3RhYmluZGV4JywgMCk7XG5cdGRldGFpbHMuYXBwZW5kKGFkZHJlc3MpO1xuXG5cdGNvbnN0IG1vcmUgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdhJyk7XG5cdG1vcmUuaW5uZXJIVE1MID0gJ1ZpZXcgRGV0YWlscyc7XG5cdG1vcmUuaHJlZiA9IERCSGVscGVyLnVybEZvclJlc3RhdXJhbnQocmVzdGF1cmFudCk7XG5cdG1vcmUuc2V0QXR0cmlidXRlKCdhcmlhLWxhYmVsJywgYFZpZXcgZGV0YWlscyBvZiAke3Jlc3RhdXJhbnQubmFtZX1gKTtcblx0ZGV0YWlscy5hcHBlbmQobW9yZSk7XG5cblx0cmV0dXJuIGxpO1xuIH07XG5cbi8qKlxuICogQWRkIG1hcmtlcnMgZm9yIGN1cnJlbnQgcmVzdGF1cmFudHMgdG8gdGhlIG1hcC5cbiAqL1xuIGFkZE1hcmtlcnNUb01hcCA9IChyZXN0YXVyYW50cyA9IHNlbGYucmVzdGF1cmFudHMpID0+IHtcblx0cmVzdGF1cmFudHMuZm9yRWFjaChyZXN0YXVyYW50ID0+IHtcblx0XHQvLyBBZGQgbWFya2VyIHRvIHRoZSBtYXBcblx0XHRjb25zdCBtYXJrZXIgPSBEQkhlbHBlci5tYXBNYXJrZXJGb3JSZXN0YXVyYW50KHJlc3RhdXJhbnQsIHNlbGYubmV3TWFwKTtcblx0XHRtYXJrZXIub24oJ2NsaWNrJywgb25DbGljayk7XG5cdFx0ZnVuY3Rpb24gb25DbGljaygpIHtcblx0XHRcdHdpbmRvdy5sb2NhdGlvbi5ocmVmID0gbWFya2VyLm9wdGlvbnMudXJsO1xuXHRcdH1cblx0XHRzZWxmLm1hcmtlcnMucHVzaChtYXJrZXIpO1xuXHR9KTtcblxuIH07XG4vKiBhZGRNYXJrZXJzVG9NYXAgPSAocmVzdGF1cmFudHMgPSBzZWxmLnJlc3RhdXJhbnRzKSA9PiB7XG4gIHJlc3RhdXJhbnRzLmZvckVhY2gocmVzdGF1cmFudCA9PiB7XG5cdC8vIEFkZCBtYXJrZXIgdG8gdGhlIG1hcFxuXHRjb25zdCBtYXJrZXIgPSBEQkhlbHBlci5tYXBNYXJrZXJGb3JSZXN0YXVyYW50KHJlc3RhdXJhbnQsIHNlbGYubWFwKTtcblx0Z29vZ2xlLm1hcHMuZXZlbnQuYWRkTGlzdGVuZXIobWFya2VyLCAnY2xpY2snLCAoKSA9PiB7XG5cdCAgd2luZG93LmxvY2F0aW9uLmhyZWYgPSBtYXJrZXIudXJsXG5cdH0pO1xuXHRzZWxmLm1hcmtlcnMucHVzaChtYXJrZXIpO1xuICB9KTtcbn0gKi9cblxuXG4vKiBNYW5hZ2UgZm9jdXMgYW5kIHRhYmluZGV4IG9uIGZpbHRlciBvcHRpb25zICovXG5cblxuXG4iXSwiZmlsZSI6Im1haW4uanMifQ==
