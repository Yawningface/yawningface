# Adds the Core Location usage strings and background mode to the app target.
#
# The app builds with GENERATE_INFOPLIST_FILE = YES, so there is no Info.plist
# to edit: these live as INFOPLIST_KEY_* build settings, and they must be on
# BOTH the Debug and Release configs. Beacon monitoring needs Always location;
# iOS asks for when-in-use first and offers Always later on its own schedule.
#
# Idempotent: run it twice and nothing changes.
#
#   gem install xcodeproj && ruby add-beacon-location-keys.rb

require "xcodeproj"

PROJECT = "YawningFace.xcodeproj"
APP_TARGET = "YawningFace"

WHEN_IN_USE = "YawningFace sees a nearby blocker beacon to start a block for that room."
ALWAYS = "YawningFace needs Always access so a room's block can start and end while the app is in your pocket."

project = Xcodeproj::Project.open(PROJECT)
app = project.targets.find { |t| t.name == APP_TARGET }
raise "app target not found" unless app

app.build_configurations.each do |config|
  s = config.build_settings
  s["INFOPLIST_KEY_NSLocationWhenInUseUsageDescription"] = WHEN_IN_USE
  s["INFOPLIST_KEY_NSLocationAlwaysAndWhenInUseUsageDescription"] = ALWAYS
  s["INFOPLIST_KEY_UIBackgroundModes"] = "location"
  puts "#{config.name}: location keys set"
end

project.save
puts "saved"
