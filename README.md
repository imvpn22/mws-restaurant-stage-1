# Restaurant Review PWA
This project is developed during my Udacity's MWS Nanodegree course.  

Project is in two parts - 
1. Server-API (Backend)
2. Restaurant-Review-App (Frontend)


------------- 

The nanodegree course was about learning how to make a PWA (Prograssive Web Application) by - 
* Making Web-app fully responsive
* Improving accessibility
* Improving the performance on mobile web browser
* Implementing offline support by using - 
    * Service worker
    * Offline caching (for static assets)
    * IndexDB caching (for dynamic data)
    * Browser Localstore (for storing data temporary)


------------

The process of learning all above was using Project-Based, and all the work which I done was of front-end.
Project was divided into 3 stages.  

### Stage 1 
  The starter project initially provided in Stage 1 was a static web-app. 
  My main task was to make the app fully responsive. For that I used two breakpoints and with use of CSS media query somehow I achieved that.
  Other task was satisfying the A11Y (accessibility) standards, which I did by adding aria-role and aria-label and tabindex for custom elements.


### Stage 2
  In this stage, previous stage code was to be used.
  Requirements of this stage was adding offline support in the app, adding PWA features and improving performance.
  Offline support means application should not crash when network fails, instead it should show something from the cached file and data.
  For caching static resources like HTML, CSS, JS and images I used browser cache with help of service worker.
  And for caching dynamic data which is coming from server in JSON format, I used IndexDB.
  Next was PWA features, for which I added a `manifest.json` file in root directory of the app.
  
  Now improving performance was a challenge. First I used Lighthouse ( Available in Chrome dev tools ) for auditing the app, which shows the metrices for Performance, PWA, Accessibility, Best Practice and SEO,  and also give suggestions to improve the particular.
  Performance improvement contains minifying JS and CSS, eliminating render-blocking resources etc. For minification of the files, I used *GULP* tasks.
  PWA standards was suggested by the Liighthouse tool and I added those according to that.


### Stage 3
  This stage was mostly focused on Performance and offline support. The requirements was as - 
  1. Adding a favorite button to make a restaurant favorite and unfavorite and update this data in server by making API call on button click, also by updating this locally (IndexDB) on successfull response.
  2. Adding a form on restaurant page to add a review, which should be responsive and accessible. It was also be updated on server, but with offline support that if network goes offline, it should save it locally(LocalStore). Also keep this data in sync with server, which means update on server when network comes back online, and update the response back in the IndexDB.
  3. Improving the performance and getting all the metrices above 90 in Lighthouse audit.
  
  
Overall this project based learning aproach was fun, I got to learn a lot of things and did experiments with the same.

------------

During the period, we have a Slack community of scholars with same course. People of community are very helpfull.
I got the chance to help many other fellows and also got helped by others.
  

