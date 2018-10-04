if (navigator.serviceWorker) {
	navigator.serviceWorker.register('/sw.js').then(function(reg) {
		console.log('Worker registered!');
		console.log(reg);
	}).catch(function(err) {
		console.log(err);
	});
}

//# sourceMappingURL=data:application/json;charset=utf8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiIiwic291cmNlcyI6WyJpbmRleENvbnRyb2xsZXIuanMiXSwic291cmNlc0NvbnRlbnQiOlsiaWYgKG5hdmlnYXRvci5zZXJ2aWNlV29ya2VyKSB7XG5cdG5hdmlnYXRvci5zZXJ2aWNlV29ya2VyLnJlZ2lzdGVyKCcvc3cuanMnKS50aGVuKGZ1bmN0aW9uKHJlZykge1xuXHRcdGNvbnNvbGUubG9nKCdXb3JrZXIgcmVnaXN0ZXJlZCEnKTtcblx0XHRjb25zb2xlLmxvZyhyZWcpO1xuXHR9KS5jYXRjaChmdW5jdGlvbihlcnIpIHtcblx0XHRjb25zb2xlLmxvZyhlcnIpO1xuXHR9KTtcbn1cbiJdLCJmaWxlIjoiaW5kZXhDb250cm9sbGVyLmpzIn0=
