import cv2

img = cv2.imread("C:\\Users\\zhaih\\OneDrive\\Documents2\\testimg.png")
gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

def update(val):
    threshold_val = cv2.getTrackbarPos("Threshold", "text")
    _, thresh = cv2.threshold(gray, threshold_val, 255, cv2.THRESH_BINARY)
    cv2.imshow("text", thresh)

cv2.namedWindow("text")
cv2.createTrackbar("Threshold", "text", 110, 255, update)

# Show initial image
update(0)

cv2.waitKey(0)
cv2.destroyAllWindows()


import pytesseract



text = pytesseract.image_to_string(img)

print(text)