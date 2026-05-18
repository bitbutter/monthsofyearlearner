# Months of the Year Learner

A dependency-free single-page browser app for memorizing English month names, month numbers, and calendar order.

Live app: https://bitbutter.github.io/monthsofyearlearner/

Open `index.html` directly in a browser, or serve the folder with any static file server. Progress is stored in `localStorage` under `monthsOfYearLearner.v1`.

Quick graduation exam test: open `https://bitbutter.github.io/monthsofyearlearner/?graduationTest=1`. This uses `monthsOfYearLearner.v1.graduationTest`, leaving normal learner progress untouched.

## Tests

```powershell
node --test tests/*.test.cjs
node --check core.js
node --check app.js
```
